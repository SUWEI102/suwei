export default function Loading() {
  return (
    <main className="min-h-svh bg-background p-4 md:p-6" aria-label="页面加载中">
      <div className="mx-auto flex max-w-7xl animate-pulse flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-muted" />
            <div className="flex flex-col gap-2">
              <div className="h-5 w-36 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
          </div>
          <div className="h-10 w-24 rounded-lg bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-xl bg-muted" />)}
        </div>
        <div className="h-16 rounded-xl bg-muted" />
        <div className="h-96 rounded-xl bg-muted" />
      </div>
    </main>
  )
}
