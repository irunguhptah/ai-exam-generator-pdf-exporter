// Memory monitoring utilities
export const getMemoryUsage = (): MemoryInfo | null => {
  if (typeof window !== 'undefined' && 'memory' in performance) {
    return (performance as any).memory;
  }
  return null;
};

export const logMemoryUsage = (context: string): void => {
  const memory = getMemoryUsage();
  if (memory) {
    console.log(`Memory Usage [${context}]:`, {
      used: `${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB`,
      total: `${Math.round(memory.totalJSHeapSize / 1024 / 1024)}MB`,
      limit: `${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)}MB`,
    });
  }
};

export const isMemoryHighUsage = (): boolean => {
  const memory = getMemoryUsage();
  if (!memory) return false;
  
  const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
  return usageRatio > 0.8; // 80% threshold
};

export const forceGarbageCollection = (): void => {
  if (typeof window !== 'undefined' && 'gc' in window) {
    (window as any).gc();
  }
};

// Interface for Chrome's memory API
interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

declare global {
  interface Window {
    gc?: () => void;
  }
}