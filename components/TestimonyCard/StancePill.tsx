import styled from "styled-components"
import type { ConferencePosition } from "../db"
import { positionLabels } from "../publish/content"

/** A conference position as text. These positions have no icons yet, so
 * cards show this where a bill position shows its thumb. */
export const StancePill = styled(
  ({
    position,
    className
  }: {
    position: ConferencePosition
    className?: string
  }) => <span className={className}>{positionLabels[position]}</span>
)`
  display: inline-block;
  padding: 0.125rem 0.625rem;
  border: 1px solid var(--maple-color-gray-subtle-border);
  border-radius: var(--maple-radius-pill);
  background: var(--maple-color-gray-subtle-bg);
  color: var(--maple-color-gray-subtle-text);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
`
