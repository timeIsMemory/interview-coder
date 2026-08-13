// Shared types for the screenshot solver pipeline (extraction → solution →
// debug). Kept dependency-free so prompts/parse can be unit-tested in Node.

export interface ProblemInfo {
  problem_statement: string
  constraints?: string
  example_input?: string
  example_output?: string
}

export interface SolutionPayload {
  code: string
  thoughts: string[]
  time_complexity: string
  space_complexity: string
}

export interface DebugPayload extends SolutionPayload {
  debug_analysis: string
}

/** Thrown when a model response cannot be turned into the expected structure. */
export class SolverParseError extends Error {
  constructor(message: string, public raw?: string) {
    super(message)
    this.name = "SolverParseError"
  }
}
