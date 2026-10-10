import { publishPartnerStore } from "./partner";
import type { DistributionContext, DistributionResult } from "../types";
export const publishOppo = (context: DistributionContext): Promise<DistributionResult> => publishPartnerStore("oppo", context.config.stores.oppo, context);
