import type { Result } from "../../types/assistant"

/** Unwrap a Result envelope, throwing the error message on failure. */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.error)
  return res.data
}

export const api = () => window.assistantAPI
