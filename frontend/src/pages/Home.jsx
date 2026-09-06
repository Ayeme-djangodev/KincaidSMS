import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import HeroReadout from "../components/HeroReadout.jsx";
import useIsMobile from "../hooks/useIsMobile.js";
import {
  IconBolt,
  IconShield,
  IconGlobe,
  IconClock,
  IconLock,
  IconGhost,
  IconTag,
  IconLayers,
  IconChevronDown,
  IconArrowRight,
} from "../components/Icons.jsx";

const FEATURES = [
  {
    icon: IconClock,
    title: "Numbers online in seconds",
    body: "Pick a service, get a live line immediately. No queue, no manual approval, no waiting on stock.",
  },
  {
    icon: IconLock,
    title: "Nothing tied to your identity",
    body: "No ID checks, no linking to your real number. Every rental is its own disposable line.",
  },
  {
    icon: IconGhost,
    title: "Gone when you're done",
    body: "Release a number the moment you're finished and it's wiped from your account history.",
  },
  {
    icon: IconTag,
    title: "Pay only for what you use",
    body: "Prices are shown up front per service. Fund your balance once, spend it down as you rent.",
  },
  {
    icon: IconGlobe,
    title: "Coverage across countries",
    body: "Route through numbers from a growing list of regions as services and stock allow.",
  },
  {
    icon: IconLayers,
    title: "Hundreds of services",
    body: "From messaging apps to marketplaces to delivery apps — most platforms are one search away.",
  },
];

const STEPS = [
  {
    title: "Create your account",
    body: "Sign up with an email and password. No phone number required to get started.",
  },
  {
    title: "Fund your balance",
    body: "Add credit once. It's spent per rental at the price shown, no surprise charges.",
  },
  {
    title: "Rent a line",
    body: "Search a service, see the price, rent a number. It's yours the instant the order clears.",
  },
  {
    title: "Read the code",
    body: "Your dashboard shows the incoming SMS as soon as it lands. Copy it and finish verifying.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "I burn through a lot of test accounts for QA. Being able to rent a number and toss it costs me less time than any other verification workaround I've tried.",
    name: "Priya Nandakumar",
    role: "QA Engineer",
  },
  {
    quote:
      "Set up a marketplace account without handing over my real number. The code showed up in maybe ten seconds.",
    name: "Marcus Oduya",
    role: "Reseller, Marketplace Goods",
  },
  {
    quote:
      "Coverage across regions is what sold me — I needed a local number for a service that only allowed one country.",
    name: "Elena Frayne",
    role: "Remote Contractor",
  },
  {
    quote:
      "The balance model makes sense to me. I load it once a month and just watch it go down per rental, no card on file with every random app.",
    name: "Tomás Vega",
    role: "Independent Developer",
  },
  {
    quote:
      "Support answered a stock question in a few minutes, not days. That alone put this above two other services I tried first.",
    name: "Ada Whitfield",
    role: "Small Business Owner",
  },
  {
    quote:
      "Clean dashboard, no clutter. I can see exactly what a number cost me and what came through on it.",
    name: "Ravi Chandrasekaran",
    role: "Product Manager",
  },
];

const FAQS = [
  {
    q: "Do I need to verify my own identity?",
    a: "No. Creating an account only needs an email and password — nothing about the number you're renting is tied back to you personally.",
  },
  {
    q: "How fast does the code actually arrive?",
    a: "Most codes land within a few seconds of the service sending them. Your dashboard checks for new messages automatically so you don't have to refresh.",
  },
  {
    q: "Can one number receive more than one code?",
    a: "Some services allow multiple codes on the same rented number during your rental window — this is shown per service before you rent.",
  },
  {
    q: "What happens to my balance if I cancel a rental early?",
    a: "You're only charged for what the number actually cost while active; any unused portion is credited back to your balance automatically.",
  },
];

export default function Home() {
  return (
    <div>
      <SiteHeader />
      <Hero />
      <FeatureStrip />
      <FeaturesGrid />
      <HowItWorks />
      <Testimonials />
      <FAQ />
      <FinalCTA />
      <SiteFooter />
    </div>
  );
}

// MOBILE NAV ADDITION: plain inline SVGs rather than assuming Icons.jsx
// exports a hamburger/close icon, since that file was never sent for me
// to check.
function IconHamburger(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconClose(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <line x1="4" y1="4" x2="20" y2="20" />
      <line x1="20" y1="4" x2="4" y2="20" />
    </svg>
  );
}

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#testimonials", label: "Testimonials" },
  { href: "#faq", label: "FAQ" },
];

function SiteHeader() {
  // Wider breakpoint than the internal app's sidebar (768) since this
  // header packs 4 nav links + 2 buttons + a logo inline -- that crowds
  // sooner than the dashboard's simpler layout, so it switches to the
  // hamburger earlier. Adjust the number here if it switches too early
  // or late in practice.
  const isMobile = useIsMobile(900);
  const [menuOpen, setMenuOpen] = useState(false);

  // Lock background scroll while the full-screen mobile menu is open --
  // without this, the page behind the overlay keeps scrolling, which
  // looks broken.
  useEffect(() => {
    document.body.style.overflow = isMobile && menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, menuOpen]);

  return (
    <header className="site-header">
      <div
        className="container"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <Link to="/" className="site-logo" onClick={() => setMenuOpen(false)}>
          <span className="mark">K</span>
          KincaidSMS
        </Link>

        {isMobile ? (
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "none",
              borderRadius: 10,
              width: 40,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <IconHamburger />
          </button>
        ) : (
          <nav className="site-nav">
            <div className="site-nav-links" style={{ display: "flex", gap: 28 }}>
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <a href="#testimonials">Testimonials</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="site-header-actions">
              <Link to="/login" className="btn ghost">
                Sign in
              </Link>
              <Link to="/register" className="btn">
                Get started
              </Link>
            </div>
          </nav>
        )}
      </div>

      {isMobile && menuOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#0a0a0a",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            padding: "20px 24px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 48,
            }}
          >
            <Link to="/" className="site-logo" onClick={() => setMenuOpen(false)}>
              <span className="mark">K</span>
              KincaidSMS
            </Link>
            <button
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "none",
                borderRadius: 10,
                width: 40,
                height: 40,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              <IconClose />
            </button>
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: 32, marginBottom: 48 }}>
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                style={{ fontSize: 22, color: "inherit", textDecoration: "none" }}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
            <Link
              to="/login"
              className="btn ghost"
              onClick={() => setMenuOpen(false)}
              style={{ flex: 1, textAlign: "center" }}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="btn"
              onClick={() => setMenuOpen(false)}
              style={{ flex: 1, textAlign: "center" }}
            >
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="container hero-inner">
        <div>
          <span className="eyebrow">
            <span className="dot" /> live lines, rented by the minute
          </span>
          <h1>
            A phone number,
            <br />
            for exactly as long
            <br />
            as you <span className="accent">need one.</span>
          </h1>
          <p className="lead">
            Rent a disposable number, receive the verification code, move on. No
            contracts, no ID checks, no number tied to your name.
          </p>
          <div className="hero-ctas">
            <Link to="/register" className="btn lg">
              Create free account <IconArrowRight width={16} height={16} />
            </Link>
            <Link to="/login" className="btn secondary lg">
              Sign in
            </Link>
          </div>
          <div className="stat-row">
            <div>
              <div className="stat-num mono">12,000+</div>
              <div className="stat-label">Numbers rented</div>
            </div>
            <div>
              <div className="stat-num mono">300+</div>
              <div className="stat-label">Services supported</div>
            </div>
            <div>
              <div className="stat-num mono">~4s</div>
              <div className="stat-label">Avg. code delivery</div>
            </div>
          </div>
        </div>
        <HeroReadout />
      </div>
    </section>
  );
}

function FeatureStrip() {
  const items = [
    { icon: IconBolt, title: "Instant activation", body: "Rented and live in one step" },
    { icon: IconShield, title: "Encrypted throughout", body: "Your account data stays protected" },
    { icon: IconGlobe, title: "Multi-region", body: "Numbers from a growing set of countries" },
  ];
  return (
    <div className="container section-tight">
      <div className="strip">
        {items.map((item) => (
          <div className="strip-item" key={item.title}>
            <item.icon className="icon" />
            <div>
              <h4>{item.title}</h4>
              <p>{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturesGrid() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" /> why kincaidsms
          </span>
          <h2>Built around one job: get you a working number, fast.</h2>
          <p>No bundled extras you didn't ask for — just a fast, private way to receive an SMS.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <f.icon className="icon" />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="section" id="how" style={{ background: "var(--surface)" }}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" /> the process
          </span>
          <h2>Four steps, start to finish</h2>
          <p>Renting a number is a straight line from signup to reading the code.</p>
        </div>
        <div className="steps">
          {STEPS.map((step, i) => (
            <div className="step" key={step.title}>
              <div className="step-num mono">{String(i + 1).padStart(2, "0")}</div>
              <h4>{step.title}</h4>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  return (
    <section className="section" id="testimonials">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" /> from people using it
          </span>
          <h2>What renters say</h2>
        </div>
        <div className="testimonial-grid">
          {TESTIMONIALS.map((t) => (
            <div className="testimonial-card" key={t.name}>
              <p className="quote">&ldquo;{t.quote}&rdquo;</p>
              <div className="testimonial-who">
                <div className="avatar-initials">{initials(t.name)}</div>
                <div>
                  <div className="name">{t.name}</div>
                  <div className="role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function initials(name) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section className="section" id="faq" style={{ background: "var(--surface)" }}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" /> questions
          </span>
          <h2>Frequently asked</h2>
        </div>
        <div className="faq">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div className="faq-item" key={item.q}>
                <button
                  className="faq-question"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  {item.q}
                  <IconChevronDown className="chevron" width={18} height={18} />
                </button>
                {isOpen && <div className="faq-answer">{item.a}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <div className="container section-tight">
      <div className="cta-band">
        <h2>Get a working number in the next minute.</h2>
        <p>Free to sign up. Fund your balance only when you're ready to rent.</p>
        <Link to="/register" className="btn lg">
          Create free account <IconArrowRight width={16} height={16} />
        </Link>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer-top">
          <div>
            <div className="site-logo">
              <span className="mark">K</span>
              KincaidSMS
            </div>
            <p className="site-footer-tagline">
              Disposable numbers for real verification codes. Rent what you
              need, release it when you're done.
            </p>
          </div>
          <div className="footer-cols">
            <div className="footer-col">
              <h5>Product</h5>
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <a href="#testimonials">Testimonials</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="footer-col">
              <h5>Account</h5>
              <Link to="/login">Sign in</Link>
              <Link to="/register">Create account</Link>
            </div>
          </div>
        </div>
        <div className="site-footer-bottom">
          © {new Date().getFullYear()} KincaidSMS. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
