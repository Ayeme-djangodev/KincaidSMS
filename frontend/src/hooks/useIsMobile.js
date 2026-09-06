import { useEffect, useState } from "react";

/**
 * Returns true when the viewport width is at or below `breakpoint` (px).
 * Updates live on resize so the header can swap between the inline nav
 * and the hamburger/overlay menu without a reload.
 */
export default function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= breakpoint : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= breakpoint);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);

  return isMobile;
}
