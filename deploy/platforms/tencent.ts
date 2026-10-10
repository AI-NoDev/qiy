import { publishPartnerStore } from "./partner";
import type { DistributionContext, DistributionResult } from "../types";
export const publishTencent = (context: DistributionContext): Promise<DistributionResult> => publishPartnerStore("tencent", context.config.stores.tencent, context);
