import Link from "next/link";
import type { DragEvent } from "react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { getMessageDragData } from "@/lib/messages/drag-utils";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useConversationView } from "@/components/messages/use-conversation-view";
import { useSelectedMailbox } from "./mailbox-provider";
import { useSidebar } from "./sidebar-state";
import { useCompose } from "./compose/compose-context";
import { Tooltip } from "./ui/tooltip";
import { FULL_ROUTE_PREFETCH } from "@/lib/navigation/prefetch";
import { preloadMailboxPage } from "./components-nav-utils";
import type { NavLink } from "./components-nav-types";

type Props = {
  link: NavLink,
  iconClassName?: string,
  labelClassName?: string,
  wrap?: boolean
}
export function NavItem({ link, iconClassName, labelClassName, wrap }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { openComposer } = useCompose();
  const { selectedMailbox } = useSelectedMailbox();
  const { minimal } = useSidebar();
  const { query } = useMailSearch();
  const [conversationView] = useConversationView();
  const [dragOver, setDragOver] = useState(false);
  const prefetchedKey = useRef<string | null>(null);

  if (!link.href) {
    return <span className="flex-1" />;
  }

  const Icon = link.icon;
  if (!Icon) return null;
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
  const classes = cn(
    "flex h-8 items-center gap-4 rounded-r-full text-sm text-[#202124] transition-colors max-md:min-h-11 max-md:text-base",
    minimal && "relative mx-auto h-8 w-14 justify-center rounded-full px-0",
    active ? "bg-[#d3e3fd] text-[#041e49] font-bold" : "hover:bg-[#e3e5e8]",
    dragOver && "bg-[#d3e3fd] text-[#041e49] ring-1 ring-[#a8c7fa]",
    link.primary &&
    "mb-4 mt-1 h-14 w-fit gap-3 rounded-2xl bg-[#c2e7ff] pl-4 pr-6 font-medium text-[#001d35] hover:bg-[#c2e7ff] hover:shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)]",
    link.count && "font-bold",
    link.primary && minimal && "h-14 w-14 rounded-2xl px-0 pl-0 pr-0",
    wrap && !minimal && "h-auto min-h-8 items-start py-1.5",
  );
  const dropProps = link.onMessageDrop
    ? {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (event: DragEvent) => {
        const payload = getMessageDragData(event.dataTransfer);
        setDragOver(false);
        if (!payload) return;
        event.preventDefault();
        link.onMessageDrop?.(payload.messageIds);
      },
    }
    : {};

  if (link.href === "/compose") {
    const composeButton = (
      <button
        type="button"
        onClick={() => openComposer()}
        className={cn(!minimal && "ml-2", classes)}
        aria-label={minimal ? link.label : undefined}
        {...dropProps}
      >
        <Icon
          size={24}
          style={{ color: link.iconColor }}
          className={iconClassName}
        />
        {!minimal && <span className={cn("flex-1", typeof link.count === "number" && link.count > 0 && "font-semibold")}>{link.label}</span>}
        {!minimal && typeof link.count === "number" && link.count > 0 && (
          <span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-neutral-700">
            {link.count > 99 ? "99+" : link.count}
          </span>
        )}
        {minimal && typeof link.count === "number" && link.count > 0 && (
          <span className="absolute right-1 -top-1 min-w-4 rounded-full bg-[#c5221f] px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {link.count > 99 ? "99+" : link.count}
          </span>
        )}
      </button>
    );
    return minimal && link.label ? <Tooltip label={link.label} placement="right" className="mx-auto">{composeButton}</Tooltip> : composeButton;
  }

  function prefetch() {
    if (!link.preloadMessages || active || !link.href) return;
    const key = [link.href, selectedMailbox?.id ?? "", query, conversationView].join("\u0000");
    if (prefetchedKey.current === key) return;
    prefetchedKey.current = key;
    router.prefetch(link.href, FULL_ROUTE_PREFETCH);
    void preloadMailboxPage(link.href, selectedMailbox?.id, { query, grouped: conversationView })
      .catch(() => { prefetchedKey.current = null; });
  }

  const navLink = (
    <Link
      href={link.href}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      aria-label={minimal ? link.label : undefined}
      className={cn(!minimal && "pl-[26px]", classes)}
      {...dropProps}
    >
      <Icon
        // className={minimal ? "h-4 w-4" : "h-5 w-5"}
        style={{ color: link.iconColor }}
        size={20}
        strokeWidth={1.75}
        className={cn("shrink-0", wrap && !minimal && "mt-px", iconClassName)}
      />
      {!minimal && <span className={cn("flex-1", wrap && "min-w-0 break-words leading-5 max-md:leading-6", labelClassName, typeof link.count === "number" && link.count > 0 && "font-bold")}>{link.label}</span>}
      {!minimal && typeof link.count === "number" && link.count > 0 && (
        <span className={cn("ml-auto mr-4 text-xs font-bold tracking-wide", active ? "text-[#041e49]" : "text-[#202124]", wrap && "shrink-0 leading-5")}>
          {link.count > 99 ? "99+" : link.count}
        </span>
      )}
      {minimal && typeof link.count === "number" && link.count > 0 && (
        <span className="absolute right-1 -top-1 min-w-4 rounded-full bg-[#c5221f] px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {link.count > 99 ? "99+" : link.count}
        </span>
      )}
    </Link>
  );

  return (
    <>
      {minimal && link.label ? <Tooltip label={link.label} placement="right" className="mx-auto">{navLink}</Tooltip> : navLink}
    </>
  );
}
