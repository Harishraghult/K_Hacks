import { CustomerRoot } from "@/components/app/CustomerRoot";

export default function CustomerLayout({ children }: LayoutProps<"/">) {
  return <CustomerRoot>{children}</CustomerRoot>;
}
