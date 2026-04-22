/**
 * Per-model pricing, sourced from env. Never estimate from prompt length —
 * processors always pass real token counts from the AI SDK's usage field.
 */
const num = (v: string | undefined, fallback: number) => {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const TEXT_PRICES: Record<string, { inputPer1M: number; outputPer1M: number }> =
  {
    "gpt-5": {
      inputPer1M: num(process.env.GPT5_INPUT_PRICE_PER_1M, 1.25),
      outputPer1M: num(process.env.GPT5_OUTPUT_PRICE_PER_1M, 10),
    },
  };

const IMAGE_PRICES: Record<string, Record<string, number>> = {
  "gpt-image-1": {
    "1024x1024": num(process.env.GPT_IMAGE_1_PRICE_PER_IMAGE, 0.04),
  },
};

export function estimateTextCost(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const prices = TEXT_PRICES[args.model];
  if (!prices) return 0;
  return (
    (args.inputTokens * prices.inputPer1M) / 1_000_000 +
    (args.outputTokens * prices.outputPer1M) / 1_000_000
  );
}

export function estimateImageCost(args: {
  model: string;
  size: string;
}): number {
  return IMAGE_PRICES[args.model]?.[args.size] ?? 0;
}
