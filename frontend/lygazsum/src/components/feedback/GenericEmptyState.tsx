import { ReactNode } from "react";

interface GenericEmptyStateProps {
  message: string;
  children?: ReactNode;
}

export function GenericEmptyState({
  message,
  children,
}: GenericEmptyStateProps) {
  return (
    <div className="flex flex-col w-3/5 mx-auto items-center justify-center text-center min-h-[calc(100vh-250px)]">
      <p className="text-neutral-700 text-lg leading-relaxed mb-6">{message}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
