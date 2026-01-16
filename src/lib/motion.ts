import { animate, spring } from "motion"

export const springConfig = {
  stiffness: 250,
  damping: 30,
}

export const fadeIn = (element: HTMLElement, delay = 0) => {
  animate(
    element,
    { opacity: [0, 1], y: [10, 0] },
    {
      duration: 0.4,
      delay,
      easing: spring(springConfig),
    },
  )
}

export const scaleIn = (element: HTMLElement) => {
  animate(
    element,
    { scale: [0.95, 1], opacity: [0, 1] },
    {
      duration: 0.3,
      easing: spring(springConfig),
    },
  )
}

export const pulse = (element: HTMLElement) => {
  animate(
    element,
    { scale: [1, 1.02, 1] },
    {
      duration: 1,
      easing: spring({ stiffness: 100, damping: 20 }),
      repeat: Number.POSITIVE_INFINITY,
    },
  )
}

export const slideIn = (element: HTMLElement, direction: "left" | "right" | "up" | "down" = "left") => {
  const transforms: Record<string, [number, number]> = {
    left: [-20, 0],
    right: [20, 0],
    up: [0, -20],
    down: [0, 20],
  }

  const [from, to] = transforms[direction]
  const axis = direction === "left" || direction === "right" ? "x" : "y"

  animate(
    element,
    { [axis]: [from, to], opacity: [0, 1] },
    {
      duration: 0.4,
      easing: spring(springConfig),
    },
  )
}
