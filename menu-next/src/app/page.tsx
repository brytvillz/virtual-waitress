export default function LandingPage() {
  return (
    <div className="plt-landing">
      <div className="plt-bg" />
      <nav className="plt-nav">
        <span className="plt-brand">Virtual Waitress</span>
        <a href="https://dashboard.virtualwaitress.com" className="plt-nav-signin">Sign In</a>
      </nav>
      <div className="plt-hero">
        <div className="plt-icon">🍽️</div>
        <h1 className="plt-title">Your table, your menu</h1>
        <p className="plt-sub">
          Scan the QR code at your table to browse the menu and order instantly — no app needed.
        </p>
        <div className="plt-actions">
          <a href="https://dashboard.virtualwaitress.com/login" className="plt-btn-signup">Get Started</a>
          <a href="https://dashboard.virtualwaitress.com" className="plt-btn-login">Sign In</a>
        </div>
        <div className="plt-features">
          <span className="plt-feat">Browse menu</span>
          <span className="plt-feat">Place orders</span>
          <span className="plt-feat">Call waiter</span>
          <span className="plt-feat">Track status</span>
        </div>
      </div>
      <p className="plt-footer">© Virtual Waitress</p>
    </div>
  );
}
