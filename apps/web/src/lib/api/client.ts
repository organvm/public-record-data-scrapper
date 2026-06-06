const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(
  /\/$/,
  ''
)

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000

// Longer timeout for specific operations (2 minutes)
const LONG_TIMEOUT_MS = 120000

export class ApiError extends Error {
  public readonly status: number
  public readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: RequestInit['body'] | Record<string, unknown>
  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout?: number
}

function resolveUrl(path: string): string {
  if (/^https?:/i.test(path)) {
    return path
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const {
    body: rawBody,
    headers: rawHeaders,
    timeout = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    ...rest
  } = options
  const headers = new Headers(rawHeaders ?? {})
  headers.set('Accept', 'application/json')

  // Attach a bearer token when one is configured (data routes are JWT-gated).
  const authToken = import.meta.env.VITE_API_TOKEN as string | undefined
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }

  let body: BodyInit | null | undefined = rawBody as BodyInit | null | undefined

  if (body && typeof body !== 'string' && !(body instanceof FormData)) {
    body = JSON.stringify(body)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }

  // Create abort controller for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // Combine with external signal if provided
  const signal = externalSignal
    ? combineAbortSignals(externalSignal, controller.signal)
    : controller.signal

  try {
    const response = await fetch(resolveUrl(path), {
      ...rest,
      headers,
      body,
      signal
    })

    clearTimeout(timeoutId)

    const contentType = response.headers.get('content-type') ?? ''
    const isJson = contentType.includes('application/json')
    let responseBody: unknown = null

    if (response.status !== 204) {
      if (isJson) {
        responseBody = await response.json()
      } else {
        const text = await response.text()
        responseBody = text.length > 0 ? text : null
      }
    }

    if (!response.ok) {
      const message =
        typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody
          ? String((responseBody as { message: unknown }).message)
          : response.statusText || 'Request failed'
      throw new ApiError(message, response.status, responseBody)
    }

    return responseBody as T
  } catch (error) {
    clearTimeout(timeoutId)

    // Check if it was a timeout
    if (error instanceof DOMException && error.name === 'AbortError') {
      // Check if it was our timeout or an external abort
      if (controller.signal.aborted && !externalSignal?.aborted) {
        throw new TimeoutError(`Request timed out after ${timeout}ms`)
      }
      throw error
    }

    if (error instanceof ApiError || error instanceof TimeoutError) {
      throw error
    }

    throw new ApiError(error instanceof Error ? error.message : 'Network request failed', 0, null)
  }
}

/**
 * Combine multiple abort signals into one
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return controller.signal
}

/**
 * Export timeout constants for use in specific API calls
 */
export { DEFAULT_TIMEOUT_MS, LONG_TIMEOUT_MS }
