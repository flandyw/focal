"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { LayoutGroup, motion } from "framer-motion"
import { useId } from "react"

import { indicatorSpring, TRANSITION } from "../../lib/progress-motion"
import { cn } from "../../lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    // Scopes the indicator's layoutId so each tab set glides on its own.
    <LayoutGroup id={useId()}>
    <TabsPrimitive.Root
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-4 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
    </LayoutGroup>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit max-w-full items-center gap-4 overflow-x-auto overscroll-x-contain scroll-px-2 border-b border-border text-muted-foreground group-data-horizontal/tabs:min-h-10 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch group-data-vertical/tabs:border-b-0 group-data-vertical/tabs:border-l",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        line: "bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-1 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-primary group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:border-b-0 group-data-vertical/tabs:border-l-2 group-data-vertical/tabs:px-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      render={(tabProps, state) => (
        <button {...tabProps}>
          {tabProps.children}
          {state.active ? <motion.span aria-hidden layoutId="tab-indicator" transition={indicatorSpring} className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-primary group-data-vertical/tabs:inset-x-auto group-data-vertical/tabs:inset-y-0 group-data-vertical/tabs:-left-0.5 group-data-vertical/tabs:h-auto group-data-vertical/tabs:w-0.5" /> : null}
        </button>
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 text-sm outline-none", className)}
      render={<motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={TRANSITION.entrance} />}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
