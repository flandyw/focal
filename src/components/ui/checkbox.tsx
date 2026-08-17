import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer size-[1.125rem] shrink-0 rounded-[0.3rem] border border-input bg-card shadow-xs outline-none transition-[background-color,border-color,box-shadow,transform] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground motion-reduce:active:scale-100",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
        <CheckIcon className="size-3.5 stroke-[3] group-data-[state=indeterminate]/checkbox:hidden" aria-hidden="true" />
        <MinusIcon className="hidden size-3.5 stroke-[3] group-data-[state=indeterminate]/checkbox:block" aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
