import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// The toast follows the system colour scheme (`theme="system"`): the panel has no theme provider. The toast colours, radius and
// shadow are tokens; the `!` marks win over the defaults that sonner sets on its own toaster element.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group [--border-radius:var(--radius)]! [--normal-bg:var(--card)]! [--normal-border:var(--border)]! [--normal-text:var(--card-foreground)]!"
      toastOptions={{ classNames: { toast: "shadow-card!" } }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      {...props}
    />
  );
};

export { Toaster };
