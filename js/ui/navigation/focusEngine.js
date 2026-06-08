import { Router } from "./router.js";
import { Platform } from "../../platform/index.js";

function buildNormalizedEvent(event) {
  const normalizedKey = Platform.normalizeKey(event);
  const normalizedCode = Number(normalizedKey.keyCode || 0);
  
  const safeTarget = event?.target || { 
    nodeType: 0, 
    parentNode: null, 
    classList: { contains: () => false } 
  };
  return {
    key: normalizedKey.key,
    code: normalizedKey.code,
    keyName: normalizedKey.keyName,
    target: event?.target || null,
    altKey: Boolean(event?.altKey),
    ctrlKey: Boolean(event?.ctrlKey),
    shiftKey: Boolean(event?.shiftKey),
    metaKey: Boolean(event?.metaKey),
    repeat: Boolean(event?.repeat),
    defaultPrevented: Boolean(event?.defaultPrevented),
    keyCode: normalizedCode,
    which: normalizedCode,
    originalKeyCode: Number(normalizedKey.originalKeyCode || event?.keyCode || 0),
    preventDefault: () => {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    },
    stopPropagation: () => {
      if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
      }
    },
    stopImmediatePropagation: () => {
      if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  };
}

export const FocusEngine = {
  lastBackHandledAt: 0,
  lastDirectionalInputAt: 0,
  lastPointerFocusTarget: null,
  pointerMoveFrame: null,
  pendingPointerMoveEvent: null,
  pointerAfterDpadGuardMs: 850,

  init() {
    this.boundHandleKey = this.handleKey.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.boundHandleTizenHardwareKey = this.handleTizenHardwareKey.bind(this);
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandlePointerClick = this.handlePointerClick.bind(this);
    this.boundHandleContextMenu = this.handleContextMenu.bind(this);
    document.addEventListener("keydown", this.boundHandleKey, true);
    document.addEventListener("keyup", this.boundHandleKeyUp, true);
    if (Platform.isTizen()) {
      document.addEventListener("tizenhwkey", this.boundHandleTizenHardwareKey, true);
    }
    if (Platform.isWebOS()) {
      document.documentElement?.classList?.add("webos-pointer-remote");
      document.body?.classList?.add("webos-pointer-remote");
    }
    // Register pointer/click events on WebOS and browser (not Tizen — D-pad only)
    if (!Platform.isTizen()) {
      document.addEventListener("mousemove", this.boundHandlePointerMove, true);
      document.addEventListener("pointermove", this.boundHandlePointerMove, true);
      document.addEventListener("click", this.boundHandlePointerClick, true);
      document.addEventListener("contextmenu", this.boundHandleContextMenu, true);
    }
  },

  handleBack(event, normalizedEvent = buildNormalizedEvent(event)) {
    const now = Date.now();
    if (now - this.lastBackHandledAt < 250) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      return;
    }
    this.lastBackHandledAt = now;

    normalizedEvent.preventDefault();
    normalizedEvent.stopPropagation();
    normalizedEvent.stopImmediatePropagation();

    const currentScreen = Router.getCurrentScreen();
    if (currentScreen?.consumeBackRequest?.()) {
      Router.suppressNextPopstate?.();
      return;
    }

    Router.back();
  },

  handleKey(event) {
    if (event?.target && !document.contains(event.target)) {
      return;
    }

    const normalizedEvent = buildNormalizedEvent(event);
    if ([37, 38, 39, 40].includes(Number(normalizedEvent.keyCode || 0))) {
      this.lastDirectionalInputAt = Date.now();
      this.lastPointerFocusTarget = null;
    }

    if (Platform.isBackEvent({
        target: normalizedEvent.target,
        key: normalizedEvent.key,
        code: normalizedEvent.code,
        keyCode: normalizedEvent.keyCode,
      })
    ) {
      this.handleBack(event, normalizedEvent);
      return;
    }

    const currentScreen = Router.getCurrentScreen();

    if (currentScreen?.onKeyDown) {
      Promise.resolve(currentScreen.onKeyDown(normalizedEvent)).catch((error) => {
        console.warn("Screen keydown handler failed", error);
      });
    }
  },

  handleKeyUp(event) {
    if (event?.target && !document.contains(event.target)) return;

    const currentScreen = Router.getCurrentScreen();
    if (!currentScreen?.onKeyUp) {
      return;
    }
    const normalizedEvent = buildNormalizedEvent(event);
    Promise.resolve(currentScreen.onKeyUp(normalizedEvent)).catch((error) => {
      console.warn("Screen keyup handler failed", error);
    });
  },

  handleTizenHardwareKey(event) {
    if (!Platform.isBackEvent(event)) {
      return;
    }
    this.handleBack(event, buildNormalizedEvent(event));
  },

  getPointerFocusable(event) {
    const target = event?.target?.closest?.(".focusable");
    if (!target || !(target instanceof HTMLElement) || !document.contains(target)) {
      return null;
    }
    if (
      target.disabled
      || target.classList.contains("is-disabled")
      || target.classList.contains("disabled")
      || target.getAttribute("aria-disabled") === "true"
    ) {
      return null;
    }
    const rect = target.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return target;
  },

  focusPointerTarget(target, event = null) {
    if (!target) {
      return false;
    }
    const currentScreen = Router.getCurrentScreen();
    const screenContainer = currentScreen?.container instanceof HTMLElement
      ? currentScreen.container
      : target.closest(".screen");
    if (screenContainer && !screenContainer.contains(target)) {
      return false;
    }

    const focusRoot = screenContainer || document;
    focusRoot.querySelectorAll?.(".focusable.focused")?.forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      try {
        target.focus();
      } catch (_) {
      }
    }
    currentScreen?.onPointerFocus?.(target, event);
    this.lastPointerFocusTarget = target;
    return true;
  },

  handlePointerMove(event) {
    if (Platform.isTizen()) {
      return;
    }
    this.pendingPointerMoveEvent = event;
    if (this.pointerMoveFrame) {
      return;
    }
    const run = () => {
      this.pointerMoveFrame = null;
      const pendingEvent = this.pendingPointerMoveEvent;
      this.pendingPointerMoveEvent = null;
      this.processPointerMove(pendingEvent);
    };
    if (typeof requestAnimationFrame === "function") {
      this.pointerMoveFrame = requestAnimationFrame(run);
    } else {
      this.pointerMoveFrame = setTimeout(run, 16);
    }
  },

  processPointerMove(event) {
    if (Platform.isTizen()) {
      return;
    }
    if (Date.now() - Number(this.lastDirectionalInputAt || 0) < this.pointerAfterDpadGuardMs) {
      return;
    }
    const currentScreen = Router.getCurrentScreen();
    currentScreen?.onPointerActivity?.(event);
    const target = this.getPointerFocusable(event);
    if (!target || target === this.lastPointerFocusTarget) {
      return;
    }
    this.focusPointerTarget(target, event);
  },

  async handlePointerClick(event) {
    if (Platform.isTizen()) {
      return;
    }
    const currentScreen = Router.getCurrentScreen();
    const target = this.getPointerFocusable(event);
    if (!target) {
      if (typeof currentScreen?.onPointerActivate === "function") {
        const rawTarget = event?.target instanceof HTMLElement ? event.target : null;
        const rawHandled = rawTarget ? await currentScreen.onPointerActivate(rawTarget, event) : false;
        if (rawHandled) {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          return;
        }
      }
      const handled = await currentScreen?.onPointerBackgroundActivate?.(event?.target || null, event);
      if (handled) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
      }
      return;
    }
    this.focusPointerTarget(target, event);
    if (typeof currentScreen?.onPointerActivate !== "function") {
      return;
    }
    const handled = await currentScreen.onPointerActivate(target, event);
    if (handled) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
    }
  },

  handleContextMenu(event) {
    if (Platform.isTizen()) {
      return;
    }
    const currentScreen = Router.getCurrentScreen();
    if (typeof currentScreen?.onContextMenu !== "function") {
      return;
    }
    const rawTarget = event?.target instanceof HTMLElement ? event.target : null;
    if (!rawTarget) {
      return;
    }
    const handled = currentScreen.onContextMenu(rawTarget, event);
    if (handled) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
    }
  },
};
