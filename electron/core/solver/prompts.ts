// Prompt builders for the screenshot solver. Pure functions that return
// provider-neutral AiMessage arrays; AiGateway handles provider-specific
// wire formats, so prompts exist exactly once regardless of provider.

import type { AiMessage } from "../ai/types"
import type { ProblemInfo } from "./types"

function imageMessages(images: string[]): { data: string; mimeType: string }[] {
  return images.map((data) => ({ data, mimeType: "image/png" }))
}

export function buildExtractionMessages(language: string, images: string[]): AiMessage[] {
  return [
    {
      role: "system",
      text: "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text."
    },
    {
      role: "user",
      text: `Extract the coding problem details from these screenshots. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`,
      images: imageMessages(images)
    }
  ]
}

export function buildSolutionPrompt(problemInfo: ProblemInfo, language: string): string {
  return `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases.
`
}

export function buildSolutionMessages(problemInfo: ProblemInfo, language: string): AiMessage[] {
  return [
    {
      role: "system",
      text: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations."
    },
    { role: "user", text: buildSolutionPrompt(problemInfo, language) }
  ]
}

const DEBUG_STRUCTURE = `Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`

export function buildDebugMessages(
  problemInfo: ProblemInfo,
  language: string,
  images: string[]
): AiMessage[] {
  return [
    {
      role: "system",
      text: `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

${DEBUG_STRUCTURE}`
    },
    {
      role: "user",
      text: `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed`,
      images: imageMessages(images)
    }
  ]
}
