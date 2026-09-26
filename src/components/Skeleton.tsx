import { uiSurfaces } from '@/lib/ui-surfaces';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`${uiSurfaces.skeleton} ${className}`}
      aria-hidden="true"
    />
  );
}

export function ProductCardSkeleton() {
  return (
    <div className={`rounded-[var(--brand-border-radius)] p-4 ${uiSurfaces.panel}`}>
      <Skeleton className="mb-3 h-40 w-full" />
      <Skeleton className="mb-2 h-3 w-20" />
      <Skeleton className="mb-1 h-4 w-full" />
      <Skeleton className="mb-1 h-3 w-32" />
      <Skeleton className="mb-3 h-3 w-24" />
      <div className="flex items-center gap-2 mt-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1220px]:grid-cols-4 min-[1500px]:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
