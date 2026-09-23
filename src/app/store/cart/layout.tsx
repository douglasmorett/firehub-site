export default function CartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="icebox-theme">
      {children}
      <style>{`
        .icebox-theme {
          --primary: #1C1917;
          --primary-hover: #1C1917;
          --primary-light: #FAF6F2;
          --shadow-primary: 0 8px 20px -6px rgba(21, 101, 192, 0.4);
        }
        .icebox-theme .gradient-text {
          background: linear-gradient(135deg, #1C1917 0%, #42A5F5 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }
        .icebox-theme .btn-primary {
          background: linear-gradient(135deg, #1C1917 0%, #1C1917 100%) !important;
          box-shadow: 0 8px 20px -6px rgba(21, 101, 192, 0.4) !important;
        }
        .icebox-theme .btn-primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #1C1917 0%, #1C1917 100%) !important;
        }
      `}</style>
    </div>
  );
}
