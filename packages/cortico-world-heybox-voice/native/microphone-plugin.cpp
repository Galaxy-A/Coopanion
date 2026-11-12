// SPDX-License-Identifier: AGPL-3.0-or-later
// VST2 capture effect: microphone samples always pass through. Pipe workers own
// source buffers; the audio callback only reads immutable PCM and atomic state.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <atomic>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <new>
#include <memory>

struct Effect;
using Dispatch = intptr_t (*)(Effect*, int32_t, int32_t, intptr_t, void*, float);
using Process = void (*)(Effect*, float**, float**, int32_t);
using Host = intptr_t (*)(Effect*, int32_t, int32_t, intptr_t, void*, float);
// Public VST2 effect ABI. No SDK implementation is linked or distributed.
struct Effect {
    int32_t magic; Dispatch dispatcher; Process process;
    void (*setParameter)(Effect*, int32_t, float);
    float (*getParameter)(Effect*, int32_t);
    int32_t numPrograms, numParams, numInputs, numOutputs, flags;
    void* reserved1; void* reserved2;
    int32_t initialDelay, realQualities, offQualities;
    float ioRatio; void* object; void* user;
    int32_t uniqueId, version; Process processReplacing;
    void (*processDoubleReplacing)(Effect*, double**, double**, int32_t);
    char future[56];
};
static_assert(sizeof(Effect) == 192, "The microphone effect requires the x64 VST2 ABI.");

namespace {
constexpr uint32_t Magic = 0x314D4248; // HBM1, little endian.
constexpr uint32_t MaxBytes = 32 * 1024 * 1024;
constexpr DWORD IoTimeout = 30000;
std::atomic<unsigned> serial{0};

struct Playback {
    std::vector<int16_t> samples;
    uint32_t rate, channels, frames;
    double position = 0;
    std::atomic<bool> completed{false};
};
static_assert(std::atomic<Playback*>::is_always_lock_free && std::atomic<double>::is_always_lock_free
    && std::atomic<uint64_t>::is_always_lock_free && std::atomic<unsigned>::is_always_lock_free,
    "Audio callback state must use lock-free atomics.");
struct Request { uint32_t magic, operation, rate, channels, bytes, reserved; };
static_assert(sizeof(Request) == 24, "IPC request layout changed.");

struct Instance {
    Effect effect{};
    std::atomic<double> rate{48000};
    std::atomic<uint64_t> callbacks{0};
    std::atomic<bool> running{false};
    std::atomic<Playback*> playback{nullptr};
    std::atomic<unsigned> readers{0};
    HANDLE stop = nullptr, statusThread = nullptr, audioThread = nullptr;
    std::string chunk, pipeStem, descriptor;

    void clearPlayback() {
        Playback* previous = playback.exchange(nullptr);
        while (readers.load()) Sleep(1);
        delete previous;
    }
    void close() {
        if (!stop) return;
        SetEvent(stop);
        if (statusThread) { WaitForSingleObject(statusThread, INFINITE); CloseHandle(statusThread); }
        if (audioThread) { WaitForSingleObject(audioThread, INFINITE); CloseHandle(audioThread); }
        statusThread = audioThread = nullptr;
        clearPlayback();
        CloseHandle(stop); stop = nullptr;
    }
    ~Instance() { close(); }
};

bool stopped(Instance* self) { return WaitForSingleObject(self->stop, 0) == WAIT_OBJECT_0; }

bool transfer(Instance* self, HANDLE pipe, void* bytes, DWORD size, bool write, DWORD timeout = IoTimeout) {
    auto* data = static_cast<uint8_t*>(bytes);
    const ULONGLONG deadline = GetTickCount64() + timeout;
    while (size && !stopped(self)) {
        OVERLAPPED op{}; op.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!op.hEvent) return false;
        DWORD done = 0;
        BOOL ok = write ? WriteFile(pipe, data, size, &done, &op) : ReadFile(pipe, data, size, &done, &op);
        if (!ok && GetLastError() == ERROR_IO_PENDING) {
            HANDLE waits[] = {self->stop, op.hEvent};
            ULONGLONG now = GetTickCount64();
            DWORD result = WaitForMultipleObjects(2, waits, FALSE, now >= deadline ? 0 : static_cast<DWORD>(deadline - now));
            if (result == WAIT_OBJECT_0 + 1) ok = GetOverlappedResult(pipe, &op, &done, FALSE);
            else {
                CancelIoEx(pipe, &op); GetOverlappedResult(pipe, &op, &done, TRUE); ok = FALSE;
            }
        }
        CloseHandle(op.hEvent);
        if (!ok || !done) return false;
        data += done; size -= done;
    }
    return size == 0;
}
bool emit(Instance* self, HANDLE pipe, const char* line) {
    return transfer(self, pipe, const_cast<char*>(line), static_cast<DWORD>(std::strlen(line)), true, 2000);
}
bool active(Instance* self) {
    uint64_t before = self->callbacks.load(std::memory_order_relaxed);
    if (WaitForSingleObject(self->stop, 80) != WAIT_TIMEOUT) return false;
    return self->running.load(std::memory_order_relaxed)
        && before != self->callbacks.load(std::memory_order_relaxed);
}
void awaitDisconnect(Instance* self, HANDLE pipe) {
    const ULONGLONG deadline = GetTickCount64() + 1000;
    while (!stopped(self) && GetTickCount64() < deadline) {
        DWORD available = 0;
        if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &available, nullptr) || available) return;
        WaitForSingleObject(self->stop, 5);
    }
}

void serve(Instance* self, HANDLE pipe, bool audio) {
    Request request{};
    if (!transfer(self, pipe, &request, sizeof(request), false)
        || request.magic != Magic || request.reserved != 0
        || request.operation != (audio ? 1u : 0u)) return;
    if (!active(self)) { emit(self, pipe, "{\"type\":\"inactive\"}\n"); awaitDisconnect(self, pipe); return; }
    if (!audio) { emit(self, pipe, "{\"type\":\"active\"}\n"); awaitDisconnect(self, pipe); return; }
    if (request.rate < 8000 || request.rate > 192000 || (request.channels != 1 && request.channels != 2)
        || !request.bytes || request.bytes > MaxBytes || request.bytes % (request.channels * 2)) {
        emit(self, pipe, "{\"type\":\"invalid\"}\n"); awaitDisconnect(self, pipe); return;
    }
    if (!emit(self, pipe, "{\"type\":\"accepted\"}\n")) return;
    auto source = std::unique_ptr<Playback>(new Playback);
    source->samples.resize(request.bytes / 2);
    source->rate = request.rate; source->channels = request.channels;
    source->frames = request.bytes / (request.channels * 2);
    if (!transfer(self, pipe, source->samples.data(), request.bytes, false)) return;
    self->clearPlayback();
    Playback* owned = source.release();
    self->playback.store(owned);
    if (!emit(self, pipe, "{\"type\":\"started\"}\n")) { self->clearPlayback(); return; }
    const ULONGLONG deadline = GetTickCount64() + static_cast<ULONGLONG>(1000.0 * owned->frames / owned->rate) + 5000;
    uint64_t callbacks = self->callbacks.load(std::memory_order_relaxed);
    ULONGLONG progressAt = GetTickCount64();
    bool completed = false;
    while (!stopped(self)) {
        if (owned->completed.load(std::memory_order_acquire)) { completed = true; break; }
        DWORD available = 0;
        if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &available, nullptr) || available) break;
        ULONGLONG now = GetTickCount64();
        uint64_t next = self->callbacks.load(std::memory_order_relaxed);
        if (next != callbacks) { callbacks = next; progressAt = now; }
        if (now >= deadline || now - progressAt > 1000) break;
        WaitForSingleObject(self->stop, 5);
    }
    self->clearPlayback();
    emit(self, pipe, completed ? "{\"type\":\"completed\"}\n" : "{\"type\":\"stopped\"}\n");
    awaitDisconnect(self, pipe);
}

void worker(Instance* self, bool audio) {
    PSECURITY_DESCRIPTOR security = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorA(self->descriptor.c_str(), SDDL_REVISION_1, &security, nullptr)) return;
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), security, FALSE};
    std::string name = self->pipeStem + (audio ? ".audio" : ".status");
    HANDLE pipe = CreateNamedPipeA(name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 65536, 65536, 0, &attributes);
    if (pipe == INVALID_HANDLE_VALUE) { LocalFree(security); return; }
    while (!stopped(self)) {
        OVERLAPPED connection{}; connection.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        bool connected = false;
        if (connection.hEvent) {
            if (ConnectNamedPipe(pipe, &connection)) connected = true;
            else {
                DWORD error = GetLastError();
                if (error == ERROR_PIPE_CONNECTED) connected = true;
                else if (error == ERROR_IO_PENDING) {
                    HANDLE waits[] = {self->stop, connection.hEvent};
                    if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) == WAIT_OBJECT_0 + 1) {
                        DWORD count = 0; connected = GetOverlappedResult(pipe, &connection, &count, FALSE) != FALSE;
                    } else { CancelIoEx(pipe, &connection); DWORD count = 0; GetOverlappedResult(pipe, &connection, &count, TRUE); }
                }
            }
            CloseHandle(connection.hEvent);
        }
        if (connected && !stopped(self)) {
            try { serve(self, pipe, audio); }
            catch (...) { if (audio) self->clearPlayback(); }
        }
        CancelIoEx(pipe, nullptr); DisconnectNamedPipe(pipe);
    }
    CloseHandle(pipe);
    LocalFree(security);
}
DWORD WINAPI statusWorker(void* context) { try { worker(static_cast<Instance*>(context), false); } catch (...) {} return 0; }
DWORD WINAPI audioWorker(void* context) { try { worker(static_cast<Instance*>(context), true); } catch (...) {} return 0; }

bool configure(Instance* self, const void* bytes, intptr_t size) {
    if (!bytes || size < 40 || size > 256) return false;
    std::string chunk(static_cast<const char*>(bytes), static_cast<size_t>(size));
    if (chunk.compare(0, 7, "heybox:") != 0 || chunk[39] != ':') return false;
    std::string token = chunk.substr(7, 32), sid = chunk.substr(40);
    for (char c : token) if (!((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9'))) return false;
    if (sid.compare(0, 4, "S-1-") != 0) return false;
    for (char c : sid) if (c != 'S' && c != '-' && (c < '0' || c > '9')) return false;
    PSID checked = nullptr;
    if (!ConvertStringSidToSidA(sid.c_str(), &checked)) return false;
    LocalFree(checked);
    self->close();
    self->chunk = chunk;
    self->descriptor = "D:P(A;;GA;;;SY)(A;;GA;;;LS)(A;;GA;;;NS)(A;;GRGW;;;" + sid + ")S:(ML;;NW;;;LW)";
    self->pipeStem = "\\\\.\\pipe\\GhostCompanion.Heybox." + token + "." + std::to_string(GetCurrentProcessId()) + "." + std::to_string(++serial);
    self->stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!self->stop) return false;
    self->statusThread = CreateThread(nullptr, 0, statusWorker, self, 0, nullptr);
    self->audioThread = CreateThread(nullptr, 0, audioWorker, self, 0, nullptr);
    if (!self->statusThread || !self->audioThread) { self->close(); return false; }
    return true;
}

float mono(const Playback* source, uint32_t frame) {
    const uint32_t offset = frame * source->channels;
    float value = static_cast<float>(source->samples[offset]) / 32768.0f;
    if (source->channels == 2) value = (value + static_cast<float>(source->samples[offset + 1]) / 32768.0f) * 0.5f;
    return value;
}
void process(Effect* effect, float** inputs, float** outputs, int32_t count) {
    if (count <= 0) return;
    auto* self = static_cast<Instance*>(effect->object);
    self->readers.fetch_add(1);
    Playback* source = self->playback.load();
    const double rate = self->rate.load(std::memory_order_relaxed);
    const bool mix = source && self->running.load(std::memory_order_relaxed) && rate >= 8000 && rate <= 192000;
    for (int32_t frame = 0; frame < count; ++frame) {
        float speech = 0;
        if (mix && source->position < source->frames) {
            uint32_t index = static_cast<uint32_t>(source->position);
            float fraction = static_cast<float>(source->position - index);
            float left = mono(source, index), right = mono(source, std::min(index + 1, source->frames - 1));
            speech = left + (right - left) * fraction;
            source->position += static_cast<double>(source->rate) / rate;
        }
        for (unsigned channel = 0; channel < 2; ++channel) {
            float mic = inputs && inputs[channel] ? inputs[channel][frame] : 0;
            if (outputs && outputs[channel]) outputs[channel][frame] = speech == 0 ? mic : std::max(-1.0f, std::min(1.0f, mic + speech));
        }
    }
    if (mix && source->position >= source->frames) source->completed.store(true, std::memory_order_release);
    self->readers.fetch_sub(1);
    self->callbacks.fetch_add(1, std::memory_order_relaxed);
}

intptr_t dispatch(Effect* effect, int32_t opcode, int32_t, intptr_t value, void* pointer, float option) {
    auto* self = static_cast<Instance*>(effect->object);
    try {
        switch (opcode) {
        case 0: return 1;
        case 1: delete self; return 1;
        case 10: if (option >= 8000 && option <= 192000) self->rate.store(option); return 1;
        case 11: return 1;
        case 12: self->running.store(value != 0); return 1;
        case 23: if (!pointer) return 0; *static_cast<void**>(pointer) = const_cast<char*>(self->chunk.data()); return self->chunk.size();
        case 24: return configure(self, pointer, value) ? 1 : 0;
        case 35: return 1;
        case 45: if (pointer) std::strcpy(static_cast<char*>(pointer), "HeyBox Microphone"); return 1;
        case 47: if (pointer) std::strcpy(static_cast<char*>(pointer), "GhostCompanion"); return 1;
        case 48: if (pointer) std::strcpy(static_cast<char*>(pointer), "HeyBox Microphone"); return 1;
        case 49: return 1;
        case 51: return 0;
        case 58: return 2400;
        case 71: self->running.store(true); return 1;
        case 72: self->running.store(false); return 1;
        default: return 0;
        }
    } catch (...) { return 0; }
}
}

extern "C" __declspec(dllexport) Effect* VSTPluginMain(Host) {
    try {
        auto* self = new Instance;
        Effect& effect = self->effect;
        effect.magic = 0x56737450; effect.dispatcher = dispatch; effect.process = process;
        effect.numPrograms = 1; effect.numInputs = 2; effect.numOutputs = 2;
        effect.flags = (1 << 4) | (1 << 5); // replacing + program chunks.
        effect.ioRatio = 1; effect.object = self; effect.uniqueId = 0x4743484D;
        effect.version = 1; effect.processReplacing = process;
        return &effect;
    } catch (...) { return nullptr; }
}
