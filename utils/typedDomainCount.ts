import { parseDomainList } from "../server/utils/checkInput";
import { normalizeDomain } from "../server/utils/domain";

// The server caps valid rows only, so invalid entries don't count toward the max.
export function typedDomainCount(text: string): number {
  return parseDomainList(text).filter((s) => normalizeDomain(s)).length;
}
