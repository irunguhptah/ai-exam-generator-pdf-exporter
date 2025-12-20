"use client";

import { useEffect, useState } from "react";
import ErrorReporter from "@/components/ErrorReporter";
import VisualEditsMessenger from "../visual-edits/VisualEditsMessenger";

export default function ClientComponents() {
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  if (!isClient) return null;
  
  return (
    <>
      <ErrorReporter />
      <VisualEditsMessenger />
    </>
  );
}