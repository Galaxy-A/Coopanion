using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Process loopback includes only the selected process tree. PCM stays in the stdout pipe.
public static class HeyboxProcessCapture
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ActivationParams { public int Type; public uint ProcessId; public int Mode; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Blob { public uint Size; public IntPtr Data; }
    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant { public ushort Type, Reserved1, Reserved2, Reserved3; public Blob Blob; }
    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormat
    {
        public ushort Tag, Channels;
        public uint Rate, BytesPerSecond;
        public ushort Alignment, Bits, Extra;
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateOperation
    {
        [PreserveSig] int GetActivateResult(out int result, out IntPtr audio);
    }
    [ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateCompletion
    {
        [PreserveSig] int ActivateCompleted(IActivateOperation operation);
    }
    [ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int mode, uint flags, long duration, long periodicity, ref WaveFormat format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int mode, ref WaveFormat format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long normal, out long minimum);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }
    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong qpc);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }
    [DllImport("Mmdevapi.dll", CharSet = CharSet.Unicode)]
    private static extern int ActivateAudioInterfaceAsync(string path, ref Guid iid, ref PropVariant parameters,
        IActivateCompletion completion, out IActivateOperation operation);

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class Completion : IActivateCompletion, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public object Audio;
        public Exception Error;
        public int ActivateCompleted(IActivateOperation operation)
        {
            IntPtr audio = IntPtr.Zero;
            try
            {
                int result;
                Check(operation.GetActivateResult(out result, out audio), "GetActivateResult");
                Check(result, "Process loopback activation");
                Audio = Marshal.GetObjectForIUnknown(audio);
            }
            catch (Exception error) { Error = error; }
            finally { if (audio != IntPtr.Zero) Marshal.Release(audio); Done.Set(); }
            return 0;
        }
    }

    private static void Check(int result, string operation)
    {
        if (result < 0) throw new IOException(operation + " failed (HRESULT 0x" + unchecked((uint)result).ToString("X8") + ").");
    }
    private static void Emit(TextWriter output, object value)
    {
        output.WriteLine(new JavaScriptSerializer().Serialize(value));
        output.Flush();
    }

    public static void List(TextWriter output)
    {
        List<Dictionary<string, object>> candidates = new List<Dictionary<string, object>>();
        HashSet<int> ids = new HashSet<int>();
        using (ManagementObjectSearcher search = new ManagementObjectSearcher(
            "SELECT ProcessId, ParentProcessId, Name, CreationDate FROM Win32_Process WHERE Name = 'HeyboxChat.exe'"))
        using (ManagementObjectCollection processes = search.Get())
        {
            foreach (ManagementObject process in processes)
            using (process)
            {
                int pid = Convert.ToInt32(process["ProcessId"]);
                ids.Add(pid);
                string creation = process["CreationDate"] as string;
                candidates.Add(new Dictionary<string, object> {
                    { "pid", pid }, { "parentPid", Convert.ToInt32(process["ParentProcessId"]) },
                    { "name", (string)process["Name"] },
                    { "startedAt", creation == null ? null : ManagementDateTimeConverter.ToDateTime(creation).ToUniversalTime().ToString("o") }
                });
            }
        }
        candidates.RemoveAll(candidate => ids.Contains((int)candidate["parentPid"]));
        Emit(output, new { type = "processes", processes = candidates });
    }

    public static void Run(int pid, Stream input, TextWriter output)
    {
        if (pid <= 0) throw new ArgumentException("A positive target process ID is required.");
        using (Process target = Process.GetProcessById(pid))
        using (ManualResetEvent cancelled = new ManualResetEvent(false))
        using (AutoResetEvent samplesReady = new AutoResetEvent(false))
        {
            // Keep the process handle open so an exited target cannot be replaced by a reused PID.
            IntPtr processHandle = target.Handle;
            Task.Run(() => { try { input.ReadByte(); } catch { } cancelled.Set(); });
            ActivationParams settings = new ActivationParams { Type = 1, ProcessId = (uint)pid, Mode = 0 };
            IntPtr settingsMemory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ActivationParams)));
            IActivateOperation activation = null;
            Completion completion = new Completion();
            IAudioClient client = null;
            IAudioCaptureClient capture = null;
            bool started = false;
            string reason = "stopped";
            try
            {
                Marshal.StructureToPtr(settings, settingsMemory, false);
                PropVariant parameters = new PropVariant { Type = 65, Blob = new Blob {
                    Size = (uint)Marshal.SizeOf(typeof(ActivationParams)), Data = settingsMemory } };
                Guid clientId = typeof(IAudioClient).GUID;
                Check(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref clientId, ref parameters, completion, out activation), "ActivateAudioInterfaceAsync");
                int activationWait = WaitHandle.WaitAny(new WaitHandle[] { completion.Done, cancelled }, 20000);
                if (activationWait == WaitHandle.WaitTimeout) throw new TimeoutException("Process loopback activation timed out.");
                if (activationWait == 1)
                {
                    // Keep activation data alive until its asynchronous completion releases it.
                    if (!completion.Done.WaitOne(20000)) throw new TimeoutException("Cancelled process loopback activation did not finish.");
                    return;
                }
                if (completion.Error != null) throw completion.Error;
                client = (IAudioClient)completion.Audio;
                if (target.HasExited) throw new IOException("The target process exited before capture started.");
                WaveFormat format = new WaveFormat { Tag = 1, Channels = 1, Rate = 16000,
                    BytesPerSecond = 32000, Alignment = 2, Bits = 16, Extra = 0 };
                // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY.
                Check(client.Initialize(0, 0x88060000, 0, 0, ref format, IntPtr.Zero), "IAudioClient.Initialize");
                Guid captureId = typeof(IAudioCaptureClient).GUID;
                object service;
                Check(client.GetService(ref captureId, out service), "IAudioClient.GetService");
                capture = (IAudioCaptureClient)service;
                Check(client.SetEventHandle(samplesReady.SafeWaitHandle.DangerousGetHandle()), "IAudioClient.SetEventHandle");
                Check(client.Start(), "IAudioClient.Start");
                started = true;
                Emit(output, new { type = "started", pid = pid, sampleRate = 16000, channels = 1, bitsPerSample = 16,
                    mode = "include-target-process-tree" });
                byte[] chunk = new byte[640];
                int chunkAt = 0;
                long sequence = 0, discontinuities = 0;
                Stopwatch clock = Stopwatch.StartNew();
                long nextStatus = 1000;
                while (!cancelled.WaitOne(0))
                {
                    if (target.HasExited) { reason = "target-exited"; break; }
                    WaitHandle.WaitAny(new WaitHandle[] { samplesReady, cancelled }, 20);
                    uint available;
                    Check(capture.GetNextPacketSize(out available), "IAudioCaptureClient.GetNextPacketSize");
                    while (available > 0 && !cancelled.WaitOne(0))
                    {
                        IntPtr data;
                        uint frames, flags;
                        ulong position, qpc;
                        Check(capture.GetBuffer(out data, out frames, out flags, out position, out qpc), "IAudioCaptureClient.GetBuffer");
                        try
                        {
                            if ((flags & 1) != 0) discontinuities++;
                            int bytes = checked((int)frames * 2), at = 0;
                            while (at < bytes)
                            {
                                int count = Math.Min(chunk.Length - chunkAt, bytes - at);
                                if ((flags & 2) != 0) Array.Clear(chunk, chunkAt, count);
                                else Marshal.Copy(IntPtr.Add(data, at), chunk, chunkAt, count);
                                chunkAt += count;
                                at += count;
                                if (chunkAt == chunk.Length)
                                {
                                    Emit(output, new { type = "pcm", sequence = sequence++, pcm = Convert.ToBase64String(chunk), discontinuities = discontinuities });
                                    chunkAt = 0;
                                }
                            }
                        }
                        finally { Check(capture.ReleaseBuffer(frames), "IAudioCaptureClient.ReleaseBuffer"); }
                        Check(capture.GetNextPacketSize(out available), "IAudioCaptureClient.GetNextPacketSize");
                    }
                    if (clock.ElapsedMilliseconds >= nextStatus)
                    {
                        Emit(output, new { type = "status", discontinuities = discontinuities });
                        nextStatus = clock.ElapsedMilliseconds + 1000;
                    }
                }
            }
            finally
            {
                int stopResult = started ? client.Stop() : 0;
                if (capture != null) Marshal.ReleaseComObject(capture);
                if (client != null) Marshal.ReleaseComObject(client);
                else if (completion.Audio != null) Marshal.ReleaseComObject(completion.Audio);
                if (activation != null) Marshal.ReleaseComObject(activation);
                Marshal.FreeHGlobal(settingsMemory);
                Check(stopResult, "IAudioClient.Stop");
            }
            Emit(output, new { type = "stopped", reason = reason });
        }
    }
}
