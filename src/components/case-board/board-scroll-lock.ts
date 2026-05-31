// Tiny shared flag so a scrollable group list can suppress the board's
// wheel-zoom while the pointer is over it — otherwise wheeling to scroll the
// list would also zoom the whole board. Set by CaseGroup on pointer enter /
// leave; read by the board's wheel handler. Single board instance, so a module
// singleton is enough (no context plumbing through the drei portal).
export const boardScrollLock = { locked: false }
