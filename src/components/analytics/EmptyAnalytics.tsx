import { BarChart3, Plus } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { REDUCED_TRANSITION, pressable, staggerContainer, staggerItem } from "@/lib/motion"

interface EmptyAnalyticsProps {
  onNewSession: () => void
}

export function EmptyAnalytics({ onNewSession }: EmptyAnalyticsProps) {
  const reduceMotion = useReducedMotion() === true

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center px-5 text-center"
      variants={staggerContainer(0.08, 0.1)}
      initial={reduceMotion ? false : "initial"}
      animate={reduceMotion ? undefined : "animate"}
    >
      <motion.div variants={staggerItem} className="mb-5">
        <motion.div
          animate={reduceMotion ? undefined : { y: [0, -3, 0] }}
          transition={
            reduceMotion
              ? REDUCED_TRANSITION
              : { duration: 4, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <BarChart3 className="h-10 w-10 text-muted-foreground/25" aria-hidden="true" />
        </motion.div>
      </motion.div>
      <motion.h2 variants={staggerItem} className="mb-2 text-base font-semibold">
        No study analytics yet
      </motion.h2>
      <motion.p
        variants={staggerItem}
        className="mb-2 max-w-64 text-sm leading-relaxed text-muted-foreground"
      >
        Complete your first study session to see analytics about your study habits.
      </motion.p>
      <motion.div variants={staggerItem} className="mt-2">
        <Button
          onClick={() => onNewSession()}
          size="sm"
          className="gap-1.5"
          {...pressable(reduceMotion)}
        >
          <Plus className="h-4 w-4" />
          Plan study session
        </Button>
      </motion.div>
    </motion.div>
  )
}
