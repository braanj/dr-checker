import { afterEach, describe, expect, it, vi } from "vitest";
import { focusWhenPresent } from "../utils/focusWhenPresent";

function setup() {
  const frames: (() => void)[] = [];
  const el = { focus: vi.fn() };
  let present = false;
  vi.stubGlobal("document", { getElementById: (id: string) => (present && id === "target" ? el : null) });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  return {
    el,
    appear: () => (present = true),
    runFrame: () => frames.shift()?.(),
    pending: () => frames.length,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("focusWhenPresent", () => {
  it("focuses the element right away when it is already there", () => {
    const t = setup();
    t.appear();
    focusWhenPresent("target");
    expect(t.el.focus).toHaveBeenCalledOnce();
    expect(t.pending()).toBe(0);
  });

  it("focuses the element once it mounts on a later frame", () => {
    const t = setup();
    focusWhenPresent("target");
    t.runFrame();
    expect(t.el.focus).not.toHaveBeenCalled();
    t.appear();
    t.runFrame();
    expect(t.el.focus).toHaveBeenCalledOnce();
    expect(t.pending()).toBe(0);
  });

  it("stops trying after the timeout", () => {
    vi.useFakeTimers();
    const t = setup();
    focusWhenPresent("target", 2000);
    vi.advanceTimersByTime(2001);
    t.runFrame();
    expect(t.pending()).toBe(0);
    t.appear();
    expect(t.el.focus).not.toHaveBeenCalled();
  });
});
