'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CalendarRange, Cloud, Download, FileSpreadsheet, HardDriveDownload, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { toast } from 'sonner'

type BackupCenterProps = {
  storeName: string
  version: string
  counts: { contracts: number; devices: number; payments: number; members: number }
  lastUpdated: string | null
}

export function BackupCenter({ storeName, version, counts, lastUpdated }: BackupCenterProps) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showRestore, setShowRestore] = useState(false)
  const [snapshots, setSnapshots] = useState<Array<{id:number;backupType:string;recordCount:number;checksum:string;createdAt:string}>>([])
  const [restorePayload, setRestorePayload] = useState<unknown>(null)
  const [preview, setPreview] = useState<{createdAt:string;recordCount:number;checksum:string;counts:Record<string,number>}|null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [restoring, setRestoring] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadSnapshots = () => fetch('/api/backups').then(response => response.json()).then(data => setSnapshots(data.snapshots || [])).catch(() => undefined)
  useEffect(() => { loadSnapshots() }, [])

  async function createCloudBackup() {
    setBusyAction('working')
    try { const response = await fetch('/api/backups', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'manual'}) }); const body=await response.json(); if(!response.ok)throw new Error(body.error); await loadSnapshots(); toast.success('云端恢复快照已创建') } catch(error){toast.error(error instanceof Error?error.message:'备份失败')} finally{setBusyAction(null)}
  }
  async function inspectBackup(file: File) {
    try { const payload=JSON.parse(await file.text()); const response=await fetch('/api/backups/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'preview',payload})}); const body=await response.json(); if(!response.ok)throw new Error(body.error); setRestorePayload(payload);setPreview(body.summary);setConfirmation('');toast.success('备份预检通过') } catch(error){setRestorePayload(null);setPreview(null);toast.error(error instanceof Error?error.message:'备份文件无效')}
  }
  async function confirmRestore(){if(!restorePayload)return;setRestoring(true);try{const response=await fetch('/api/backups/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'restore',payload:restorePayload,confirmation})});const body=await response.json();if(!response.ok)throw new Error(body.error);toast.success(`已恢复 ${body.restored.recordCount} 条记录`);setPreview(null);setRestorePayload(null);setConfirmation('');await loadSnapshots()}catch(error){const raw=error instanceof Error?error.message:'';toast.error(raw.includes('toISOString')?'备份中的时间字段格式不正确，恢复已停止，现有数据未被修改':raw||'恢复失败，现有数据未被修改')}finally{setRestoring(false)}}

  async function downloadFile(endpoint: string, filename: string, success: string) {
    setBusyAction('working')
    try {
      const response = await fetch(endpoint)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || '导出失败')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setBusyAction(null)
    }
  }

  async function downloadExport() {
    if (from && to && from > to) return toast.error('开始日期不能晚于结束日期')
    setBusyAction('working')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const response = await fetch(`/api/exports/business?${params.toString()}`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || '导出失败')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${storeName.replace(/[\\/:*?"<>|]/g, '-')}租赁数据-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Excel 数据包已下载')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setBusyAction(null)
    }
  }

  const latestSnapshot = snapshots[0]
  const snapshotLabel = (type: string) => type === 'pre-restore' ? '恢复前保护点' : type === 'exit' ? '安全退出备份' : type === 'manual' ? '手动备份' : '自动备份'

  return <main className="min-h-svh bg-muted/40">
    <div className="border-b bg-card"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-6"><div className="flex items-center gap-4"><Link href="/" aria-label="返回经营总览" className="flex size-9 items-center justify-center rounded-lg border hover:bg-muted"><ArrowLeft className="size-4"/></Link><div><h1 className="text-xl font-bold text-balance md:text-2xl">版本与备份中心</h1><p className="text-sm text-muted-foreground">{storeName} · 数据保护与系统维护</p></div></div><span className="rounded-full border bg-background px-3 py-1.5 font-mono text-xs">v{version}</span></div></div>
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="h-fit rounded-xl border bg-card p-3 lg:sticky lg:top-6"><div className="border-b p-3"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="size-5"/></span><div><p className="text-sm font-semibold">保护状态正常</p><p className="text-xs text-muted-foreground">自动备份已开启</p></div></div></div><nav aria-label="备份中心导航" className="mt-2 flex gap-2 overflow-x-auto lg:flex-col"><a href="#overview" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">安全总览</a><a href="#exports" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted">导出与留档</a><a href="#snapshots" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted">云端保护点</a><a href="#restore" className="rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">数据恢复</a></nav><div className="mt-3 hidden border-t p-3 text-xs leading-5 text-muted-foreground lg:block">最近业务更新<br/><span className="font-medium text-foreground">{lastUpdated ? new Date(lastUpdated).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '暂无业务数据'}</span></div></aside>
      <div className="flex min-w-0 flex-col gap-6">
      <section id="overview" className="overflow-hidden rounded-2xl bg-primary text-primary-foreground"><div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8"><div><p className="text-sm font-medium text-primary-foreground/75">当前数据安全状态</p><h2 className="mt-2 text-2xl font-bold text-balance md:text-3xl">业务数据已受保护</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-primary-foreground/80">每 30 分钟自动生成云端快照；安全退出时再保存云端保护点，并下载 JSON 与 Excel 到默认下载目录。</p><div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>最近备份：<strong>{latestSnapshot ? new Date(latestSnapshot.createdAt).toLocaleString('zh-CN',{hour12:false}) : '尚未创建'}</strong></span><span>保护记录：<strong>{latestSnapshot?.recordCount ?? 0} 条</strong></span></div></div><button type="button" onClick={createCloudBackup} disabled={busyAction!==null} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-background px-6 font-semibold text-foreground shadow-sm disabled:opacity-60">{busyAction==='working'?<RefreshCw className="size-4 animate-spin"/>:<Cloud className="size-4"/>}立即创建云备份</button></div><div className="grid grid-cols-2 border-t border-primary-foreground/20 md:grid-cols-4">{[['合同',counts.contracts],['设备',counts.devices],['收款',counts.payments],['员工',counts.members]].map(([label,value])=><div key={String(label)} className="border-r border-primary-foreground/20 px-5 py-4 last:border-r-0"><p className="text-xs text-primary-foreground/70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div></section>

      <section id="exports" className="rounded-2xl border bg-card"><div className="flex flex-col gap-2 border-b p-6"><p className="text-sm font-medium text-primary">导出与留档</p><h2 className="text-xl font-bold">选择需要保存的数据文件</h2><p className="text-sm text-muted-foreground">JSON 用于系统恢复，Excel 用于日常查阅和人工留档。</p></div><div className="divide-y"><div className="grid gap-5 p-6 md:grid-cols-[1fr_auto] md:items-center"><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><HardDriveDownload className="size-5"/></span><div><h3 className="font-semibold">JSON 完整恢复包</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">保留所有业务表、关联关系和字段类型，系统故障时可直接预检恢复。</p></div></div><button type="button" onClick={()=>downloadFile('/api/backups?download=json',`rental-backup-${new Date().toISOString().slice(0,10)}.json`,'JSON 恢复包已下载')} disabled={busyAction!==null} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 font-medium hover:bg-muted disabled:opacity-60"><Download className="size-4"/>下载 JSON</button></div><div className="grid gap-5 p-6 md:grid-cols-[1fr_auto] md:items-center"><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet className="size-5"/></span><div><h3 className="font-semibold">管理员 Excel 数据包</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">合同、设备、收款、续租、买断、退租、丢失和员工账号分别成表。</p><button type="button" onClick={()=>setShowFilters(value=>!value)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary"><CalendarRange className="size-4"/>{showFilters?'收起日期范围':'设置日期范围（可选）'}</button>{showFilters&&<div className="mt-3 grid max-w-lg gap-3 rounded-xl bg-muted p-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-xs">开始日期<input type="date" value={from} onChange={event=>setFrom(event.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm"/></label><label className="flex flex-col gap-1 text-xs">结束日期<input type="date" value={to} onChange={event=>setTo(event.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm"/></label></div>}</div></div><button type="button" onClick={downloadExport} disabled={busyAction!==null} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 font-medium hover:bg-muted disabled:opacity-60"><Download className="size-4"/>下载 Excel</button></div><div className="grid gap-5 p-6 md:grid-cols-[1fr_auto] md:items-center"><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet className="size-5"/></span><div><h3 className="font-semibold">员工租机明细表</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">保留员工熟悉的旧表顺序，并自动拆分在租和历史清单。</p></div></div><button type="button" onClick={()=>downloadFile('/api/exports/rental-ledger',`${storeName.replace(/[\\/:*?\"<>|]/g,'-')}租机明细全表-${new Date().toISOString().slice(0,10)}.xlsx`,'员工租机明细表已下载')} disabled={busyAction!==null} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 font-medium hover:bg-muted disabled:opacity-60"><Download className="size-4"/>下载明细表</button></div></div></section>

      <section id="snapshots" className="overflow-hidden rounded-2xl border bg-card"><div className="flex items-center justify-between gap-4 border-b p-6"><div><p className="text-sm font-medium text-primary">云端保护点</p><h2 className="mt-1 text-xl font-bold">备份历史</h2><p className="mt-1 text-sm text-muted-foreground">按时间保留最近的可恢复快照，数据仅属于当前公司。</p></div><button type="button" onClick={loadSnapshots} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted"><RefreshCw className="size-4"/>刷新</button></div><div className="max-h-80 overflow-auto"><div className="min-w-[620px]"><div className="grid grid-cols-[1fr_1.3fr_100px_120px] border-b bg-muted/60 px-6 py-3 text-xs font-medium text-muted-foreground"><span>保护点类型</span><span>创建时间</span><span>记录数</span><span>校验码</span></div>{snapshots.map(snapshot=><div key={snapshot.id} className="grid grid-cols-[1fr_1.3fr_100px_120px] items-center border-b px-6 py-4 text-sm last:border-b-0"><span className="font-medium">{snapshotLabel(snapshot.backupType)}</span><span className="text-muted-foreground">{new Date(snapshot.createdAt).toLocaleString('zh-CN',{hour12:false})}</span><span>{snapshot.recordCount} 条</span><code className="text-xs text-muted-foreground">{snapshot.checksum.slice(0,10)}</code></div>)}{!snapshots.length&&<p className="p-8 text-center text-sm text-muted-foreground">暂无云端保护点，请先创建备份。</p>}</div></div></section>

      <section id="restore" className="rounded-2xl border border-destructive/30 bg-card"><div className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><Upload className="size-5"/></span><div><p className="text-sm font-medium text-destructive">高风险操作</p><h2 className="mt-1 text-xl font-bold">从备份文件恢复数据</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">仅在系统故障或升级异常时使用。恢复会替换当前公司数据，但执行前会自动创建保护点，失败时完整回滚。</p></div></div><button type="button" onClick={()=>setShowRestore(value=>!value)} className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-destructive/30 px-4 font-medium text-destructive hover:bg-destructive/10">{showRestore?'收起恢复工具':'进入恢复流程'}</button></div>{showRestore&&<div className="border-t border-destructive/20 bg-destructive/5 p-6"><div className="grid gap-4 md:grid-cols-3"><Step number="1" title="选择恢复包" text="上传系统导出的 JSON 文件" active={!preview}/><Step number="2" title="预检数据" text={preview?`已通过，共 ${preview.recordCount} 条记录`:'校验版本、公司与数据结构'} active={Boolean(preview)}/><Step number="3" title="确认恢复" text="输入确认文字后执行" active={Boolean(preview)}/></div><input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={event=>{const file=event.target.files?.[0];if(file)void inspectBackup(file)}}/><button type="button" onClick={()=>fileRef.current?.click()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-4 font-medium"><Upload className="size-4"/>选择 JSON 恢复包</button>{preview&&<div className="mt-5 max-w-xl rounded-xl border bg-card p-5"><p className="font-semibold">预检通过：{preview.recordCount} 条记录</p><p className="mt-1 text-xs text-muted-foreground">备份时间 {new Date(preview.createdAt).toLocaleString('zh-CN',{hour12:false})} · 校验 {preview.checksum.slice(0,16)}</p><label className="mt-4 flex flex-col gap-2 text-sm font-medium">输入“确认恢复”<input value={confirmation} onChange={event=>setConfirmation(event.target.value)} className="h-10 rounded-lg border bg-background px-3"/></label><button type="button" onClick={confirmRestore} disabled={restoring||confirmation!=='确认恢复'} className="mt-3 h-10 rounded-lg bg-destructive px-4 font-medium text-destructive-foreground disabled:opacity-50">{restoring?'正在恢复并校验':'确认并全量恢复'}</button></div>}</div>}</section>

      <details className="rounded-xl border bg-card"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold">查看升级与备份说明</summary><div className="grid gap-5 border-t px-5 py-4 text-sm leading-6 text-muted-foreground md:grid-cols-2"><div><p className="font-medium text-foreground">升级前建议</p><p className="mt-1">先创建云端保护点并下载 JSON 恢复包，再在 Preview 环境检查合同、收款和权限功能。</p></div><div><p className="font-medium text-foreground">文件用途</p><p className="mt-1">JSON 用于系统恢复；Excel 用于业务查阅和离线留档，不能替代恢复包。</p></div></div></details>
      </div>
    </div>
  </main>
}

function Step({number,title,text,active}:{number:string;title:string;text:string;active:boolean}) { return <div className="flex items-start gap-3 rounded-xl border bg-card p-4"><span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground'}`}>{number}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div> }
