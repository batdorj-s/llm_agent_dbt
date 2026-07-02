import React from "react";
import { Loader2 } from "lucide-react";

const PageLoading: React.FC = () => (
  <div className="pt-[100px] text-center">
    <Loader2 className="w-8 h-8 text-foreground/30 animate-spin mx-auto" />
  </div>
);

export default PageLoading;
