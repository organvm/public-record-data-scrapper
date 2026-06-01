/// <reference types="vite/client" />
declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string

declare module 'papaparse' {
  interface ParseConfig {
    header?: boolean
    skipEmptyLines?: boolean
    dynamicTyping?: boolean
    transformHeader?: (header: string) => string
    transform?: (value: unknown) => unknown
  }
  interface ParseResult {
    data: Record<string, unknown>[]
  }
  function parse(input: string, config?: ParseConfig): ParseResult
  export default { parse }
}

declare module 'playwright' {
  interface Browser {
    newPage(): Promise<Page>
    newContext(options?: {
      userAgent?: string
      proxy?: { server: string }
    }): Promise<BrowserContext>
    close(): Promise<void>
  }
  interface BrowserContext {
    newPage(): Promise<Page>
    close(): Promise<void>
  }
  interface Page {
    goto(url: string): Promise<void>
    fill(selector: string, value: string): Promise<void>
    click(selector: string): Promise<void>
    waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>
    waitForLoadState(state: string): Promise<void>
    content(): Promise<string>
    evaluate<T>(fn: () => T): Promise<T>
    close(): Promise<void>
    $: (selector: string) => Promise<unknown | null>
    $$: (selector: string) => Promise<unknown[]>
    locator(selector: string): unknown
    setDefaultTimeout(timeout: number): void
    isClosed(): boolean
    screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>
  }
  const chromium: {
    launch(options?: { headless?: boolean; proxy?: { server: string } }): Promise<Browser>
  }
  export { Browser, BrowserContext, Page, chromium }
}

declare module 'winston' {
  namespace winston {
    interface Logger {
      error(message: string, meta?: unknown): void
      warn(message: string, meta?: unknown): void
      info(message: string, meta?: unknown): void
      debug(message: string, meta?: unknown): void
      log(level: string, message: string, meta?: unknown): void
    }
    namespace format {
      function combine(...formats: unknown[]): unknown
      function timestamp(opts?: unknown): unknown
      function errors(opts?: unknown): unknown
      function metadata(opts?: unknown): unknown
      function json(): unknown
      function colorize(): unknown
      function printf(fn: (info: Record<string, unknown>) => string): unknown
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface TransportOptions {}
    class Transport {}
    namespace transports {
      class Console extends Transport {
        constructor(opts?: TransportOptions & { format?: unknown; level?: string })
      }
      class File extends Transport {
        constructor(
          opts?: TransportOptions & {
            filename?: string
            format?: unknown
            level?: string
            maxsize?: number
            maxFiles?: number
          }
        )
      }
    }
    interface LoggerOptions {
      level?: string
      format?: unknown
      transports?: Transport[]
      exitOnError?: boolean
    }
    function createLogger(opts?: LoggerOptions): Logger
  }
  export = winston
}
