using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// One request per process. Stdin EOF cancels playback and releases the selected device.
public static class HeyboxVoiceAudio
{
    private const int MaxPcmBytes = 32 * 1024 * 1024;
    private const uint HeaderDone = 1;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OutputCaps
    {
        public ushort Manufacturer, Product;
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint Formats;
        public ushort Channels, Reserved;
        public uint Support;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct InputCaps
    {
        public ushort Manufacturer, Product;
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint Formats;
        public ushort Channels, Reserved;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormat
    {
        public ushort FormatTag, Channels;
        public uint SamplesPerSecond, AverageBytesPerSecond;
        public ushort BlockAlign, BitsPerSample, ExtraSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHeader
    {
        public IntPtr Data;
        public uint BufferLength, BytesRecorded;
        public UIntPtr User;
        public uint Flags, Loops;
        public IntPtr Next;
        public UIntPtr Reserved;
    }

    [DllImport("winmm.dll")] private static extern uint waveOutGetNumDevs();
    [DllImport("winmm.dll")] private static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern uint waveOutGetDevCapsW(UIntPtr id, out OutputCaps caps, uint size);
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern uint waveInGetDevCapsW(UIntPtr id, out InputCaps caps, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutOpen(out IntPtr handle, uint device, ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] private static extern uint waveOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern uint waveOutWrite(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern uint waveOutReset(IntPtr handle);
    [DllImport("winmm.dll")] private static extern uint waveOutUnprepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern uint waveOutClose(IntPtr handle);

    private static void Check(uint result, string operation)
    {
        if (result != 0) throw new IOException(operation + " failed (WinMM " + result + ").");
    }

    private static void Emit(TextWriter output, object value)
    {
        output.WriteLine(Json.Serialize(value));
        output.Flush();
    }

    private static byte[] ReadExactly(Stream input, int size)
    {
        byte[] bytes = new byte[size];
        int at = 0;
        while (at < size)
        {
            int read = input.Read(bytes, at, size - at);
            if (read == 0) throw new EndOfStreamException("Audio request input closed.");
            at += read;
        }
        return bytes;
    }

    private static Dictionary<string, object> ReadFrame(Stream input)
    {
        byte[] length = ReadExactly(input, 4);
        uint size = BitConverter.ToUInt32(length, 0);
        if (size == 0 || size > 16384) throw new InvalidDataException("Invalid audio request frame length.");
        string body = new System.Text.UTF8Encoding(false, true).GetString(ReadExactly(input, (int)size));
        return Json.Deserialize<Dictionary<string, object>>(body);
    }

    private static int Number(Dictionary<string, object> request, string key)
    {
        object value;
        if (!request.TryGetValue(key, out value) || !(value is int)) throw new InvalidDataException("Invalid " + key + ".");
        return (int)value;
    }

    private static string Text(Dictionary<string, object> request, string key)
    {
        object value;
        if (!request.TryGetValue(key, out value) || !(value is string)) throw new InvalidDataException("Invalid " + key + ".");
        return (string)value;
    }

    private static List<object> Devices()
    {
        List<object> devices = new List<object>();
        for (uint id = 0; id < waveOutGetNumDevs(); id++)
        {
            OutputCaps caps;
            Check(waveOutGetDevCapsW(new UIntPtr(id), out caps, (uint)Marshal.SizeOf(typeof(OutputCaps))), "waveOutGetDevCapsW");
            devices.Add(new { id = (int)id, name = caps.Name, direction = "output" });
        }
        for (uint id = 0; id < waveInGetNumDevs(); id++)
        {
            InputCaps caps;
            Check(waveInGetDevCapsW(new UIntPtr(id), out caps, (uint)Marshal.SizeOf(typeof(InputCaps))), "waveInGetDevCapsW");
            devices.Add(new { id = (int)id, name = caps.Name, direction = "input" });
        }
        return devices;
    }

    private static uint SelectOutput(string name)
    {
        if (String.IsNullOrWhiteSpace(name)) throw new InvalidDataException("An exact output device name is required.");
        uint selected = 0;
        int matches = 0;
        for (uint id = 0; id < waveOutGetNumDevs(); id++)
        {
            OutputCaps caps;
            Check(waveOutGetDevCapsW(new UIntPtr(id), out caps, (uint)Marshal.SizeOf(typeof(OutputCaps))), "waveOutGetDevCapsW");
            if (String.Equals(caps.Name, name, StringComparison.Ordinal)) { selected = id; matches++; }
        }
        if (matches == 0) throw new InvalidDataException("Output device not found: " + name);
        if (matches > 1) throw new InvalidDataException("Output device name is ambiguous: " + name);
        return selected;
    }

    private static void Play(Stream input, TextWriter output, Dictionary<string, object> request)
    {
        string deviceName = Text(request, "deviceName");
        int rate = Number(request, "sampleRate"), channels = Number(request, "channels");
        int bits = Number(request, "bitsPerSample"), bytes = Number(request, "pcmBytes");
        if (rate < 8000 || rate > 192000 || (channels != 1 && channels != 2) || bits != 16)
            throw new InvalidDataException("Only PCM16, one or two channels, 8000-192000 Hz is supported.");
        if (bytes <= 0 || bytes > MaxPcmBytes || bytes % (channels * 2) != 0)
            throw new InvalidDataException("Invalid PCM byte count or sample alignment.");
        uint device = SelectOutput(deviceName);
        byte[] pcm = ReadExactly(input, bytes);
        int cancelled = 0;
        Task.Run(() => {
            try { input.ReadByte(); } catch { }
            Interlocked.Exchange(ref cancelled, 1);
        });
        WaveFormat format = new WaveFormat {
            FormatTag = 1, Channels = (ushort)channels, SamplesPerSecond = (uint)rate,
            AverageBytesPerSecond = (uint)(rate * channels * 2), BlockAlign = (ushort)(channels * 2),
            BitsPerSample = 16, ExtraSize = 0
        };
        IntPtr handle = IntPtr.Zero, header = IntPtr.Zero;
        GCHandle pinned = default(GCHandle);
        bool prepared = false;
        uint headerSize = (uint)Marshal.SizeOf(typeof(WaveHeader));
        try
        {
            if (Interlocked.CompareExchange(ref cancelled, 0, 0) != 0) throw new OperationCanceledException("Audio input closed.");
            Check(waveOutOpen(out handle, device, ref format, IntPtr.Zero, IntPtr.Zero, 0), "waveOutOpen");
            OutputCaps openedCaps;
            Check(waveOutGetDevCapsW(new UIntPtr(unchecked((ulong)handle.ToInt64())), out openedCaps, (uint)Marshal.SizeOf(typeof(OutputCaps))), "waveOutGetDevCapsW");
            if (!String.Equals(openedCaps.Name, deviceName, StringComparison.Ordinal))
                throw new IOException("The output device changed while opening it.");
            pinned = GCHandle.Alloc(pcm, GCHandleType.Pinned);
            header = Marshal.AllocHGlobal((int)headerSize);
            Marshal.StructureToPtr(new WaveHeader { Data = pinned.AddrOfPinnedObject(), BufferLength = (uint)bytes }, header, false);
            Check(waveOutPrepareHeader(handle, header, headerSize), "waveOutPrepareHeader");
            prepared = true;
            if (Interlocked.CompareExchange(ref cancelled, 0, 0) != 0) throw new OperationCanceledException("Audio input closed.");
            Check(waveOutWrite(handle, header, headerSize), "waveOutWrite");
            Emit(output, new { type = "opened", deviceId = device, deviceName = deviceName });
            DateTime deadline = DateTime.UtcNow.AddSeconds((double)bytes / format.AverageBytesPerSecond + 15);
            while (true)
            {
                if (Interlocked.CompareExchange(ref cancelled, 0, 0) != 0) throw new OperationCanceledException("Audio input closed.");
                WaveHeader state = (WaveHeader)Marshal.PtrToStructure(header, typeof(WaveHeader));
                if ((state.Flags & HeaderDone) != 0) break;
                if (DateTime.UtcNow > deadline) throw new TimeoutException("Audio device did not complete playback.");
                Thread.Sleep(10);
            }
        }
        finally
        {
            // Reset returns every submitted buffer before its pinned memory is released.
            uint resetResult = 0, unprepareResult = 0, closeResult = 0;
            if (handle != IntPtr.Zero)
            {
                resetResult = waveOutReset(handle);
                if (prepared) unprepareResult = waveOutUnprepareHeader(handle, header, headerSize);
                closeResult = waveOutClose(handle);
            }
            // A driver still owning its header keeps the buffer pinned until process exit.
            if (unprepareResult == 0)
            {
                if (header != IntPtr.Zero) Marshal.FreeHGlobal(header);
                if (pinned.IsAllocated) pinned.Free();
            }
            Check(resetResult, "waveOutReset");
            Check(unprepareResult, "waveOutUnprepareHeader");
            Check(closeResult, "waveOutClose");
        }
        Emit(output, new { type = "completed" });
    }

    public static void Run(Stream input, TextWriter output)
    {
        Emit(output, new { type = "ready" });
        Dictionary<string, object> request = ReadFrame(input);
        string operation = Text(request, "operation");
        if (operation == "list") Emit(output, new { type = "devices", devices = Devices() });
        else if (operation == "play") Play(input, output, request);
        else throw new InvalidDataException("Unknown audio operation.");
    }
}
