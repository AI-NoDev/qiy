import { publishPartnerStore } from "./partner";
import type { DistributionContext, DistributionResult } from "../types";
export const publishVivo = (context: DistributionContext): Promise<DistributionResult> => publishPartnerStore("vivo", context.config.stores.vivo, context);
