// No portal shell — clean page for printing
export default function PdfLayout({ children }: { children: React.ReactNode }) {
  return <div className="pdf-layout-body">{children}</div>
}
