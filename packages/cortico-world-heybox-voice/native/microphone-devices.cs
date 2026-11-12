using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Endpoint identifiers are retained; friendly names are display-only.
public static class HeyboxMicrophoneDevices
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class Enumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, out IntPtr instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
    private static void Check(int result) { Marshal.ThrowExceptionForHR(result); }
    private static void Release(object value) { if (value != null) Marshal.ReleaseComObject(value); }

    public static object[] List()
    {
        IMMDeviceEnumerator enumerator = null;
        IMMDeviceCollection collection = null;
        IMMDevice current = null;
        var devices = new List<object>();
        try
        {
            enumerator = (IMMDeviceEnumerator)new Enumerator();
            string defaultId = "";
            if (enumerator.GetDefaultAudioEndpoint(1, 2, out current) >= 0)
            {
                Check(current.GetId(out defaultId));
                Release(current); current = null;
            }
            Check(enumerator.EnumAudioEndpoints(1, 1, out collection));
            uint count; Check(collection.GetCount(out count));
            for (uint index = 0; index < count; index++)
            {
                IPropertyStore store = null;
                try
                {
                    Check(collection.Item(index, out current));
                    string id; Check(current.GetId(out id));
                    Check(current.OpenPropertyStore(0, out store));
                    PropertyKey key = new PropertyKey { Format = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Id = 14 };
                    PropVariant value; Check(store.GetValue(ref key, out value));
                    string name;
                    try { name = value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : id; }
                    finally { PropVariantClear(ref value); }
                    devices.Add(new { id = id, name = name, isDefault = String.Equals(id, defaultId, StringComparison.OrdinalIgnoreCase) });
                }
                finally { Release(store); Release(current); current = null; }
            }
        }
        finally { Release(current); Release(collection); Release(enumerator); }
        return devices.ToArray();
    }
}
