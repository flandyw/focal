"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { useBackClose } from "../../lib/mobile"
import { cn } from "../../lib/utils"
import { Button } from "./button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay/40 dark:bg-overlay/65 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/** Phone dialogs are bottom sheets, so they get the sheet gestures: Back closes them, and so does dragging the handle down. */
function DragToClose({ close }: { close: React.RefObject<HTMLButtonElement | null> }) {
  useBackClose(close)
  const start = React.useRef<number | null>(null)
  const popup = (event: React.PointerEvent<HTMLDivElement>) => event.currentTarget.parentElement as HTMLElement
  const finish = (event: React.PointerEvent<HTMLDivElement>, closing: boolean) => {
    if (start.current === null) return
    const dragged = event.clientY - start.current
    start.current = null
    popup(event).style.translate = ""
    if (closing && dragged > 80) close.current?.click()
  }
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 z-10 flex h-7 touch-none justify-center pt-2 sm:hidden"
      onPointerDown={(event) => { start.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={(event) => { if (start.current !== null) popup(event).style.translate = `0 ${Math.max(0, event.clientY - start.current)}px` }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
    >
      <span className="h-1 w-9 rounded-full bg-border" />
    </div>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const close = React.useRef<HTMLButtonElement>(null)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-var(--keyboard-inset))] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-6 text-sm text-popover-foreground shadow-xl duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 max-sm:top-auto max-sm:bottom-(--keyboard-inset) max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:duration-200 max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        <DragToClose close={close} />
        <DialogPrimitive.Close ref={close} hidden aria-hidden tabIndex={-1} />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex shrink-0 flex-col gap-2 pr-8", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      className={cn(
        "-mx-6 -mb-6 flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/40 p-6 sm:flex-row sm:flex-wrap sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "font-heading text-lg leading-tight font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
