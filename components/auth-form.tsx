'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { authClient } from '@/lib/auth-client'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const signup = mode === 'sign-up'

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const result = signup
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password })

    setLoading(false)
    if (result.error) {
      setError(result.error.message ?? '操作失败，请检查后重试')
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 sm:px-6 lg:py-12">
      <section className="flex w-full max-w-5xl overflow-hidden rounded-3xl border bg-card shadow-2xl shadow-foreground/10">
        <div className="hidden min-h-[640px] w-[45%] flex-col justify-between bg-primary p-8 text-primary-foreground md:flex lg:p-10 xl:p-12">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/20">
              <ShieldCheck aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="font-semibold tracking-tight">速维租赁管理</span>
              <span className="text-xs text-primary-foreground/65">SUWEI RENTAL OS</span>
            </div>
          </div>

          <div className="flex max-w-sm flex-col gap-6">
            <p className="text-sm font-medium tracking-widest text-primary-foreground/70">为租赁业务而生</p>
            <h2 className="text-4xl font-semibold leading-tight tracking-tight text-balance">
              每台设备有去向，
              <br />
              每笔租金有依据
            </h2>
            <p className="max-w-xs text-base leading-relaxed text-primary-foreground/75">
              从客户、合同到回款，让门店经营数据清晰、协作高效、管理更安心。
            </p>
            <ul className="flex flex-col gap-3 text-sm text-primary-foreground/85" aria-label="产品能力">
              {['租赁全流程集中管理', '业务数据安全留痕', '多设备随时访问'].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary-foreground/15">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-primary-foreground/60">
            <LockKeyhole className="size-4" aria-hidden="true" />
            <span>加密传输 · 权限隔离 · 自动备份</span>
          </div>
        </div>

        <div className="flex w-full flex-col justify-center p-6 sm:p-10 md:w-[55%] md:p-9 lg:p-14 xl:p-16">
          <div className="mb-10 flex items-center gap-3 md:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="font-semibold">速维租赁管理</span>
              <span className="text-xs text-muted-foreground">安全高效的业务工作台</span>
            </div>
          </div>

          <div className="mb-8 flex flex-col gap-3">
            <p className="text-sm font-semibold tracking-widest text-primary">
              {signup ? '创建工作台账户' : '欢迎回到 SUWEI'}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {signup ? '开始管理租赁业务' : '登录业务工作台'}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              {signup ? '填写账户信息，建立你的专属业务空间。' : '使用管理员账户登录，继续处理今天的业务。'}
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-5">
            {signup && (
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="name">
                姓名
                <span className="relative flex items-center">
                  <UserRound className="pointer-events-none absolute left-4 size-4 text-muted-foreground" aria-hidden="true" />
                  <input
                    id="name"
                    className="h-12 w-full rounded-xl border bg-background pl-11 pr-4 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    autoComplete="name"
                    placeholder="请输入姓名"
                  />
                </span>
              </label>
            )}

            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="email">
              邮箱
              <span className="relative flex items-center">
                <Mail className="pointer-events-none absolute left-4 size-4 text-muted-foreground" aria-hidden="true" />
                <input
                  id="email"
                  type="email"
                  className="h-12 w-full rounded-xl border bg-background pl-11 pr-4 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  aria-invalid={Boolean(error)}
                />
              </span>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="password">
              密码
              <span className="relative flex items-center">
                <LockKeyhole className="pointer-events-none absolute left-4 size-4 text-muted-foreground" aria-hidden="true" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="h-12 w-full rounded-xl border bg-background pl-11 pr-12 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  placeholder={signup ? '至少 8 位字符' : '请输入密码'}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'auth-error' : undefined}
                />
                <button
                  type="button"
                  className="absolute right-2 flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </span>
            </label>

            {error && (
              <p id="auth-error" role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {loading ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  <span>{signup ? '正在创建账户' : '正在安全登录'}</span>
                </>
              ) : (
                <>
                  <span>{signup ? '创建账户' : '进入工作台'}</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-center gap-1 text-sm text-muted-foreground">
            <span>{signup ? '已经有账户？' : '第一次使用？'}</span>
            <Link className="font-semibold text-primary underline-offset-4 hover:underline" href={signup ? '/sign-in' : '/sign-up'}>
              {signup ? '返回登录' : '创建账户'}
            </Link>
          </div>

          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            登录即表示你同意按照企业数据安全规范使用本系统
          </p>
        </div>
      </section>
    </main>
  )
}
