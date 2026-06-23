import type {FloatingElement, Placement, Side} from '@floating-ui/dom';
import type {CSSProperties, OnCleanup, Ref} from 'vue';
import {
  computed,
  ref,
  shallowReadonly,
  toValue,
  watch,
} from 'vue';

import type {MaybeElement, MaybeReadonlyRefOrGetter} from './types';

type Duration = number | {open?: number; close?: number};

export type TransitionStatus = 'unmounted' | 'initial' | 'open' | 'close';

/**
 * The floating context required by the transition composables.
 * Construct it from the return value of `useFloating` plus the floating element ref.
 */
export type FloatingContext = {
  /**
   * The open/close state of the floating element.
   */
  open: MaybeReadonlyRefOrGetter<boolean>;
  /**
   * The stateful placement from `useFloating`.
   */
  placement: Readonly<Ref<Placement>>;
  /**
   * The floating element template ref.
   */
  elements: {
    floating: Readonly<Ref<MaybeElement<FloatingElement>>>;
  };
};

// Converts a JS style key like `backgroundColor` to a CSS transition-property
// like `background-color`.
const camelCaseToKebabCase = (str: string): string =>
  str.replace(
    /[A-Z]+(?![a-z])|[A-Z]/g,
    ($, ofs) => (ofs ? '-' : '') + $.toLowerCase(),
  );

function execWithArgsOrReturn<T extends object | undefined>(
  valueOrFn: T | ((args: {side: Side; placement: Placement}) => T),
  args: {side: Side; placement: Placement},
): T {
  return typeof valueOrFn === 'function' ? valueOrFn(args) : valueOrFn;
}

export interface UseTransitionStatusProps {
  /**
   * The duration of the transition in milliseconds, or an object with
   * `open` and `close` keys for different durations.
   * @default 250
   */
  duration?: Duration;
}

/**
 * Provides a status string to apply CSS transitions to a floating element,
 * correctly handling placement-aware transitions.
 * @see https://floating-ui.com/docs/useTransition#usetransitionstatus
 */
export function useTransitionStatus(
  context: FloatingContext,
  props: UseTransitionStatusProps = {},
): {
  isMounted: Readonly<Ref<boolean>>;
  status: Readonly<Ref<TransitionStatus>>;
} {
  const {duration = 250} = props;

  const isNumberDuration = typeof duration === 'number';
  const closeDuration = (isNumberDuration ? duration : duration.close) || 0;

  const open = computed(() => toValue(context.open) ?? true);

  const status = ref<TransitionStatus>(open.value ? 'open' : 'unmounted');
  const isMounted = ref(open.value);

  // Watch open + floating element. Runs after DOM updates (flush: 'post') so
  // we know the element is in the DOM when we start the transition.
  watch(
    [open, () => toValue(context.elements.floating)] as const,
    ([isOpen, floatingEl], _prev, onCleanup: OnCleanup) => {
      if (!floatingEl) return;

      if (isOpen) {
        isMounted.value = true;
        // 'initial' styles applied synchronously so the browser paints them
        // before we switch to 'open' on the next frame, triggering the transition.
        status.value = 'initial';

        const frame = requestAnimationFrame(() => {
          status.value = 'open';
        });

        onCleanup(() => cancelAnimationFrame(frame));
      } else {
        status.value = 'close';

        const timeout = setTimeout(() => {
          isMounted.value = false;
          status.value = 'unmounted';
        }, closeDuration);

        onCleanup(() => clearTimeout(timeout));
      }
    },
    {flush: 'post'},
  );

  return {
    isMounted: shallowReadonly(isMounted),
    status: shallowReadonly(status),
  };
}

type CSSStylesProperty =
  | CSSProperties
  | ((params: {side: Side; placement: Placement}) => CSSProperties);

export interface UseTransitionStylesProps extends UseTransitionStatusProps {
  /**
   * The styles to apply when the floating element is initially mounted.
   * @default {opacity: 0}
   */
  initial?: CSSStylesProperty;
  /**
   * The styles to apply when the floating element is transitioning to the
   * `open` state.
   */
  open?: CSSStylesProperty;
  /**
   * The styles to apply when the floating element is transitioning to the
   * `close` state. Falls back to `initial` if not provided.
   */
  close?: CSSStylesProperty;
  /**
   * The styles to apply in all states.
   */
  common?: CSSStylesProperty;
}

/**
 * Provides styles to apply CSS transitions to a floating element, correctly
 * handling placement-aware transitions. Wrapper around `useTransitionStatus`.
 * @see https://floating-ui.com/docs/useTransition#usetransitionstyles
 */
export function useTransitionStyles(
  context: FloatingContext,
  props: UseTransitionStylesProps = {},
): {
  isMounted: Readonly<Ref<boolean>>;
  styles: Readonly<Ref<CSSProperties>>;
} {
  const {
    initial: initial_ = {opacity: 0},
    open: open_,
    close: close_,
    common: common_,
    duration = 250,
  } = props;

  const isNumberDuration = typeof duration === 'number';
  const openDuration = (isNumberDuration ? duration : duration.open) || 0;
  const closeDuration = (isNumberDuration ? duration : duration.close) || 0;

  const fnArgs = computed(() => {
    const placement = toValue(context.placement);
    const side = placement.split('-')[0] as Side;
    return {side, placement};
  });

  const {isMounted, status} = useTransitionStatus(context, {duration});

  const styles = ref<CSSProperties>({
    ...execWithArgsOrReturn(common_, fnArgs.value),
    ...execWithArgsOrReturn(initial_, fnArgs.value),
  });

  watch(
    [status, fnArgs] as const,
    ([currentStatus, args]: [TransitionStatus, {side: Side; placement: Placement}]) => {
      const initialStyles = execWithArgsOrReturn(initial_, args);
      const closeStyles = execWithArgsOrReturn(close_, args);
      const commonStyles = execWithArgsOrReturn(common_, args);
      const openStyles =
        execWithArgsOrReturn(open_, args) ||
        Object.keys(initialStyles || {}).reduce(
          (acc: Record<string, ''>, key) => {
            acc[key] = '';
            return acc;
          },
          {},
        );

      if (currentStatus === 'initial') {
        styles.value = {
          transitionProperty: (styles.value as Record<string, unknown>)
            .transitionProperty as string | undefined,
          ...commonStyles,
          ...initialStyles,
        };
      }

      if (currentStatus === 'open') {
        styles.value = {
          transitionProperty: Object.keys(openStyles)
            .map(camelCaseToKebabCase)
            .join(','),
          transitionDuration: `${openDuration}ms`,
          ...commonStyles,
          ...openStyles,
        };
      }

      if (currentStatus === 'close') {
        const closingStyles = closeStyles || initialStyles;
        styles.value = {
          transitionProperty: Object.keys(closingStyles || {})
            .map(camelCaseToKebabCase)
            .join(','),
          transitionDuration: `${closeDuration}ms`,
          ...commonStyles,
          ...closingStyles,
        };
      }
    },
    {flush: 'sync'},
  );

  return {
    isMounted,
    styles: shallowReadonly(styles),
  };
}
