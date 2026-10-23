param(
  [int]$IntervalSec = 10
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$SleepSeconds = [Math]::Max(1, $IntervalSec)

# Reading DEVPKEY_Bluetooth_Battery through Get-PnpDeviceProperty costs 1.7-8 s
# per device on some machines. SetupAPI returns the same value in milliseconds.
$btReaderSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class PowerPulseBtBattery {
  const uint DIGCF_PRESENT = 0x02;
  const uint DEVPROP_TYPE_BYTE = 0x00000003;
  const uint DEVPROP_TYPE_UINT32 = 0x00000007;
  const uint DEVPROP_TYPE_STRING = 0x00000012;

  [StructLayout(LayoutKind.Sequential)]
  public struct SP_DEVINFO_DATA {
    public uint cbSize;
    public Guid ClassGuid;
    public uint DevInst;
    public IntPtr Reserved;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct DEVPROPKEY {
    public Guid fmtid;
    public uint pid;
  }

  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr SetupDiGetClassDevs(ref Guid ClassGuid, IntPtr Enumerator, IntPtr hwndParent, uint Flags);

  [DllImport("setupapi.dll", SetLastError = true)]
  static extern bool SetupDiEnumDeviceInfo(IntPtr DeviceInfoSet, uint MemberIndex, ref SP_DEVINFO_DATA DeviceInfoData);

  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SetupDiGetDevicePropertyW")]
  static extern bool SetupDiGetDeviceProperty(IntPtr DeviceInfoSet, ref SP_DEVINFO_DATA DeviceInfoData, ref DEVPROPKEY PropertyKey, out uint PropertyType, byte[] PropertyBuffer, uint PropertyBufferSize, out uint RequiredSize, uint Flags);

  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SetupDiGetDeviceInstanceIdW")]
  static extern bool SetupDiGetDeviceInstanceId(IntPtr DeviceInfoSet, ref SP_DEVINFO_DATA DeviceInfoData, StringBuilder DeviceInstanceId, uint DeviceInstanceIdSize, out uint RequiredSize);

  [DllImport("setupapi.dll", SetLastError = true)]
  static extern bool SetupDiDestroyDeviceInfoList(IntPtr DeviceInfoSet);

  static string ReadName(IntPtr set, ref SP_DEVINFO_DATA data, DEVPROPKEY key) {
    var buffer = new byte[1024];
    uint type;
    uint needed;
    if (!SetupDiGetDeviceProperty(set, ref data, ref key, out type, buffer, (uint)buffer.Length, out needed, 0)) return "";
    if (type != DEVPROP_TYPE_STRING) return "";
    if (needed == 0 || needed > buffer.Length) return "";
    return Encoding.Unicode.GetString(buffer, 0, (int)needed).TrimEnd('\0');
  }

  static int ReadLevel(IntPtr set, ref SP_DEVINFO_DATA data, DEVPROPKEY key) {
    var buffer = new byte[8];
    uint type;
    uint needed;
    if (!SetupDiGetDeviceProperty(set, ref data, ref key, out type, buffer, (uint)buffer.Length, out needed, 0)) return -1;
    if (type == DEVPROP_TYPE_BYTE) return (int)buffer[0];
    if (type == DEVPROP_TYPE_UINT32) return (int)BitConverter.ToUInt32(buffer, 0);
    return -1;
  }

  public static string[] ReadPresent() {
    var results = new List<string>();
    var classGuid = new Guid("e0cbf06c-cd8b-4647-bb8a-263b43f0f974");
    var pkeyBattery = new DEVPROPKEY { fmtid = new Guid("104ea319-6ee2-4701-bd47-8ddbf425bbe5"), pid = 2 };
    var pkeyFriendlyName = new DEVPROPKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };

    IntPtr set = SetupDiGetClassDevs(ref classGuid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT);
    if (set == IntPtr.Zero || set == new IntPtr(-1)) return results.ToArray();
    try {
      var data = new SP_DEVINFO_DATA();
      data.cbSize = (uint)Marshal.SizeOf(typeof(SP_DEVINFO_DATA));
      for (uint index = 0; SetupDiEnumDeviceInfo(set, index, ref data); index++) {
        var idBuilder = new StringBuilder(512);
        uint needed;
        if (!SetupDiGetDeviceInstanceId(set, ref data, idBuilder, 512, out needed)) continue;
        string instanceId = idBuilder.ToString();
        if (!instanceId.StartsWith("BTHLE\\DEV_", StringComparison.OrdinalIgnoreCase) &&
            !instanceId.StartsWith("BTHENUM\\DEV_", StringComparison.OrdinalIgnoreCase)) continue;

        int level = ReadLevel(set, ref data, pkeyBattery);
        if (level < 0 || level > 100) continue;
        string name = ReadName(set, ref data, pkeyFriendlyName);
        results.Add(instanceId + "\t" + name + "\t" + level.ToString());
      }
    } finally {
      SetupDiDestroyDeviceInfoList(set);
    }
    return results.ToArray();
  }
}
'@

$btReaderReady = $false
try {
  Add-Type -TypeDefinition $btReaderSource -Language CSharp -ErrorAction Stop
  $btReaderReady = $true
}
catch {
  $btReaderReady = $false
}

# Razer 2.4G peripherals expose battery through the vendor HID report:
#   command class 0x07 / id 0x80 (level), 0x84 (charging), 91-byte feature report.
# Verified on Razer Viper V4 Pro (1532:00E6).
$razerSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class PowerPulseRazer {
  [StructLayout(LayoutKind.Sequential)]
  public struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HIDP_CAPS {
    public ushort Usage; public ushort UsagePage;
    public ushort InputReportByteLength; public ushort OutputReportByteLength; public ushort FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort NumberLinkCollectionNodes;
    public ushort NumberInputButtonCaps; public ushort NumberInputValueCaps; public ushort NumberInputDataIndices;
    public ushort NumberOutputButtonCaps; public ushort NumberOutputValueCaps; public ushort NumberOutputDataIndices;
    public ushort NumberFeatureButtonCaps; public ushort NumberFeatureValueCaps; public ushort NumberFeatureDataIndices;
  }
  [DllImport("hid.dll")] static extern bool HidD_GetAttributes(IntPtr h, ref HIDD_ATTRIBUTES a);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(IntPtr h, ref IntPtr pp);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr pp);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr pp, ref HIDP_CAPS caps);
  [DllImport("hid.dll", CharSet = CharSet.Unicode)] static extern bool HidD_GetProductString(IntPtr h, StringBuilder b, int len);
  [DllImport("hid.dll")] static extern bool HidD_GetFeature(IntPtr h, byte[] b, int len);
  [DllImport("hid.dll")] static extern bool HidD_SetFeature(IntPtr h, byte[] b, int len);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr w, int f);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr di, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA d);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, ref int required, IntPtr di);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr templ);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  static byte[] BuildRequest(byte tid, byte cls, byte id, byte size) {
    var buf = new byte[91];
    buf[0] = 0x00;
    buf[1] = 0x00;
    buf[2] = tid;
    buf[3] = 0x00; buf[4] = 0x00;
    buf[5] = 0x00;
    buf[6] = size;
    buf[7] = cls;
    buf[8] = id;
    byte crc = 0;
    for (int i = 3; i <= 88; i++) crc ^= buf[i];
    buf[89] = crc;
    buf[90] = 0x00;
    return buf;
  }

  static bool Query(IntPtr handle, byte cls, byte id, out byte[] response) {
    response = null;
    var request = BuildRequest(0x1F, cls, id, 0x02);
    if (!HidD_SetFeature(handle, request, request.Length)) return false;
    Thread.Sleep(300);
    var buffer = new byte[91];
    buffer[0] = 0x00;
    if (!HidD_GetFeature(handle, buffer, buffer.Length)) return false;
    if (buffer[1] != 0x02) return false;
    response = buffer;
    return true;
  }

  public static string[] ReadPresent() {
    var results = new List<string>();
    var hidGuid = new Guid("4d1e55b2-f16f-11cf-88cb-001111000030");
    IntPtr set = SetupDiGetClassDevs(ref hidGuid, IntPtr.Zero, IntPtr.Zero, 0x12);
    if (set == IntPtr.Zero || set == new IntPtr(-1)) return results.ToArray();
    try {
      for (int index = 0; ; index++) {
        var did = new SP_DEVICE_INTERFACE_DATA();
        did.cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA));
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hidGuid, index, ref did)) break;
        int required = 0;
        SetupDiGetDeviceInterfaceDetail(set, ref did, IntPtr.Zero, 0, ref required, IntPtr.Zero);
        if (required <= 0) continue;
        IntPtr detail = Marshal.AllocHGlobal(required);
        try {
          Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
          int needed = 0;
          if (!SetupDiGetDeviceInterfaceDetail(set, ref did, detail, required, ref needed, IntPtr.Zero)) continue;
          string path = Marshal.PtrToStringUni(new IntPtr(detail.ToInt64() + 4));
          IntPtr handle = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
          if (handle == new IntPtr(-1)) {
            // Some Razer collections deny generic read but still serve feature
            // reports through a write-only handle (seen on keyboard collections).
            handle = CreateFile(path, 0x40000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
          }
          if (handle == new IntPtr(-1)) continue;
          try {
            var attrs = new HIDD_ATTRIBUTES();
            attrs.Size = Marshal.SizeOf(typeof(HIDD_ATTRIBUTES));
            HidD_GetAttributes(handle, ref attrs);
            if (attrs.VendorID != 0x1532) continue;

            IntPtr pp = IntPtr.Zero;
            HidD_GetPreparsedData(handle, ref pp);
            var caps = new HIDP_CAPS();
            if (pp != IntPtr.Zero) { HidP_GetCaps(pp, ref caps); HidD_FreePreparsedData(pp); }
            if (caps.FeatureReportByteLength != 91) continue;

            byte[] battery;
            if (!Query(handle, 0x07, 0x80, out battery)) continue;
            // Telemetry-only collections answer with a status block that does
            // not echo data size / class / id; ignore those.
            if (battery[6] != 0x02 || battery[7] != 0x07 || battery[8] != 0x80) continue;
            int raw = battery[10];
            if (raw <= 0) continue;
            int level = (int)Math.Round(raw * 100.0 / 255.0);
            if (level < 0 || level > 100) continue;

            bool charging = false;
            byte[] chargingReport;
            if (Query(handle, 0x07, 0x84, out chargingReport) &&
                chargingReport[6] == 0x02 && chargingReport[7] == 0x07 && chargingReport[8] == 0x84) {
              charging = chargingReport[10] != 0;
            }

            var product = new StringBuilder(256);
            HidD_GetProductString(handle, product, 512);
            string name = product.ToString().Trim();
            if (name.Length == 0) name = "Razer 无线设备";

            results.Add(attrs.ProductID.ToString("X4") + "\t" + name + "\t" + level + "\t" + (charging ? "1" : "0"));
          } finally { CloseHandle(handle); }
        } finally { Marshal.FreeHGlobal(detail); }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return results.ToArray();
  }
}
'@

$razerReady = $false
try {
  Add-Type -TypeDefinition $razerSource -Language CSharp -ErrorAction Stop
  $razerReady = $true
}
catch {
  $razerReady = $false
}


function Get-SystemBatteryDevice {
  $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $battery) { return $null }
  if ($null -eq $battery.EstimatedChargeRemaining) { return $null }

  $level = [int]$battery.EstimatedChargeRemaining
  if ($level -lt 0 -or $level -gt 100) { return $null }

  $status = [int]$battery.BatteryStatus
  $powerOnline = $false
  $charging = $false
  $wmiBattery = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $wmiBattery) {
    $powerOnline = [bool]$wmiBattery.PowerOnline
    $charging = [bool]$wmiBattery.Charging
  }
  else {
    $powerOnline = ($status -eq 2 -or $status -eq 3)
  }
  if (-not $charging -and $status -ge 6 -and $status -le 9) { $charging = $true }
  if ($charging) { $powerOnline = $true }

  $minutesLeft = $null
  $estimatedRuntime = [int64]$battery.EstimatedRunTime
  if ($estimatedRuntime -gt 0 -and $estimatedRuntime -lt 100000) { $minutesLeft = [int]$estimatedRuntime }

  $name = $battery.Name
  if ([string]::IsNullOrWhiteSpace($name)) { $name = '本机电池' }

  return [ordered]@{
    id          = 'system:0'
    name        = [string]$name
    kind        = 'system'
    level       = $level
    charging    = [bool]$charging
    plugged     = [bool]$powerOnline
    minutesLeft = $minutesLeft
    source      = 'Win32_Battery'
  }
}

function Get-BluetoothBatteryDevices {
  $devices = @()
  if (-not $btReaderReady) { return $devices }
  $seen = @{}
  $rows = [PowerPulseBtBattery]::ReadPresent()
  foreach ($row in $rows) {
    $parts = $row -split "`t"
    if ($parts.Count -lt 3) { continue }
    $level = [int]$parts[2]
    if ($level -lt 0 -or $level -gt 100) { continue }

    $mac = ''
    if ($parts[0] -match 'DEV_([0-9A-Fa-f]{12})') { $mac = $Matches[1].ToUpperInvariant() }
    if ($mac -ne '' -and $seen.ContainsKey($mac)) { continue }
    if ($mac -ne '') { $seen[$mac] = $true }

    $name = [string]$parts[1]
    if ([string]::IsNullOrWhiteSpace($name)) { $name = '蓝牙设备' }

    $devices += [ordered]@{
      id          = "bt:$mac"
      name        = $name
      kind        = 'bluetooth'
      level       = $level
      charging    = $false
      plugged     = $false
      minutesLeft = $null
      source      = 'DEVPKEY_Bluetooth_Battery'
    }
  }
  return $devices
}

$razerCache = @()
$razerCacheAt = [datetime]::MinValue

function Get-RazerBatteryDevices {
  if (-not $razerReady) { return @() }
  $now = [datetime]::UtcNow
  if (($now - $razerCacheAt).TotalSeconds -lt 5) { return $razerCache }
  $devices = @()
  try {
    $rows = [PowerPulseRazer]::ReadPresent()
  }
  catch {
    $rows = @()
  }
  foreach ($row in $rows) {
    $parts = $row -split "`t"
    if ($parts.Count -lt 4) { continue }
    $level = [int]$parts[2]
    if ($level -lt 0 -or $level -gt 100) { continue }
    $name = [string]$parts[1]
    if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Razer 无线设备' }
    $charging = ($parts[3] -eq '1')
    $devices += [ordered]@{
      id          = "razer:$($parts[0])"
      name        = $name
      kind        = 'wireless'
      level       = $level
      charging    = $charging
      plugged     = $charging
      minutesLeft = $null
      source      = 'Razer HID 0x07/0x80'
    }
  }
  $razerCache = $devices
  $razerCacheAt = $now
  return $devices
}

while ($true) {
  $devices = @()
  $system = Get-SystemBatteryDevice
  if ($null -ne $system) { $devices += $system }
  $bluetooth = Get-BluetoothBatteryDevices
  if ($null -ne $bluetooth) { $devices += $bluetooth }
  $wireless = Get-RazerBatteryDevices
  if ($null -ne $wireless) { $devices += $wireless }

  $payload = [ordered]@{
    updatedAt   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    intervalSec = $SleepSeconds
    devices     = @($devices)
  }

  try {
    $payload | ConvertTo-Json -Compress -Depth 6
  }
  catch {
    '{"updatedAt":"' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + '","devices":[],"error":"serialize-failed"}'
  }

  Start-Sleep -Seconds $SleepSeconds
}
