import { publishPartnerStore } from "./partner";
import type { DistributionContext, DistributionResult } from "../types";
export const publishHonor = (context: DistributionContext): Promise<DistributionResult> => publishPartnerStore("honor", context.config.stores.honor, context);
