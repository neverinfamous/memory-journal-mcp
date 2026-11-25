/**
 * Standalone WeakSet marker tracking tool argument objects already processed by
 * `healIncomingToolCallParams`.
 * [INVARIANT] Kept in a zero-dependency leaf module so tool registration and handlers
 * never create a circular initialization cycle with `dummy-healing`.
 */
export const ALREADY_HEALED_ARGS = new WeakSet()
