export type DeviceConfigLike = {
  deviceType?: string | null
  deviceConfig?: string | null
  cpu?: string | null
  motherboard?: string | null
  memory?: string | null
  storage?: string | null
  graphicsCard?: string | null
  powerSupply?: string | null
  caseModel?: string | null
  monitorInfo?: string | null
  screenSize?: string | null
  screenResolution?: string | null
  refreshRate?: string | null
  panelType?: string | null
  ports?: string | null
  batteryInfo?: string | null
  adapterInfo?: string | null
  accessories?: string | null
  colorGamut?: string | null
}

const fields: Record<string, Array<[keyof DeviceConfigLike, string]>> = {
  台式机: [['cpu','CPU'],['motherboard','主板'],['memory','内存'],['storage','硬盘'],['graphicsCard','显卡'],['powerSupply','电源'],['caseModel','机箱']],
  笔记本: [['cpu','CPU'],['memory','内存'],['storage','硬盘'],['graphicsCard','显卡'],['screenSize','屏幕尺寸'],['screenResolution','分辨率'],['batteryInfo','电池'],['adapterInfo','适配器']],
  显示器: [['screenSize','屏幕尺寸'],['screenResolution','分辨率'],['refreshRate','刷新率'],['panelType','面板'],['colorGamut','色域'],['ports','接口'],['monitorInfo','支架功能'],['accessories','配件']],
  一体机: [['cpu','CPU'],['memory','内存'],['storage','硬盘'],['graphicsCard','显卡'],['screenSize','屏幕尺寸'],['screenResolution','分辨率'],['ports','接口'],['accessories','配件']],
  其他: [['deviceConfig','其他配置']],
}

export function getDeviceConfigRows(device: DeviceConfigLike) {
  return (fields[device.deviceType || '其他'] || fields.其他).map(([key, label]) => ({ label, value: String(device[key] ?? '') }))
}

export function formatDeviceConfig(device: DeviceConfigLike, includeEmpty = false) {
  return getDeviceConfigRows(device).filter(row => includeEmpty || row.value.trim()).map(row => `${row.label}：${row.value}`).join(' / ')
}
