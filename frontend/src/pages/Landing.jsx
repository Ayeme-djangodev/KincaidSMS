import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const DEMO_CODE = "482 913";

function useTypedCode(code) {
  const [shown, setShown] = useState("");
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    let i = 0;
    setShown("");
    const id = setInterval(() => {
      i += 1;
      setShown(code.slice(0, i));
      if (i >= code.length) {
        clearInterval(id);
        setTimeout(() => setCycle((c) => c + 1), 2200);
      }
    }, 140);
    return () => clearInterval(id);
  }, [code, cycle]);

  return shown;
}

function TickerCard() {
  const shown = useTypedCode(DEMO_CODE);
  return (
    <div className="ticker-card">
      <div className="ticker-head">
        <span><span className="ticker-dot" />listening for SMS</span>
        <span>rental #A19F</span>
      </div>
      <div className="ticker-body">
        <div className="ticker-number">+1 (312) 555-0148 &middot; WhatsApp</div>
        <div className="ticker-code">
          {shown || "\u00A0"}
          <span className="ticker-caret" />
        </div>
        <div className="ticker-meta">received in 4.2s &middot; auto-polled every 5s</div>
      </div>
    </div>
  );
}

const heroBadges = [
  "Instant delivery",
  "No manual approval",
  "Wallet-based, no card per rental",
];

const stats = [
  { num: "300+", label: "Services live" },
  { num: "<5s", label: "Avg. code delivery" },
  { num: "99.9%", label: "Uptime target" },
];

const features = [
  { title: "Instant Access", body: "No queue, no waiting on a dashboard \u2014 numbers are issued the moment you rent." },
  { title: "Fully Automated", body: "Every rental goes straight to the carrier network. Nothing here is approved by hand." },
  { title: "Transparent Pricing", body: "You see the exact customer price up front \u2014 markup included, no surprise fees at checkout." },
  { title: "Full Audit Ledger", body: "Every deposit, charge, and refund is logged. Your balance is always explainable." },
  { title: "300+ Services", body: "WhatsApp, Google, Telegram, and hundreds more, with live stock and pricing." },
  { title: "Refund on Cancel", body: "Didn't get a code? Cancel the rental and the unused balance comes right back." },
];

const steps = [
  { num: "1", title: "Deposit", body: "Fund your wallet once \u2014 no re-entering payment details per rental." },
  { num: "2", title: "Choose a service", body: "Pick from 300+ live services, priced and stocked in real time." },
  { num: "3", title: "Receive the code", body: "We poll for the SMS and surface it the instant it lands." },
  { num: "4", title: "Complete or cancel", body: "Mark it done, or cancel and get the unused balance refunded." },
];

const testimonials = [
  { quote: "Switched over from a competitor and the code delivery time alone was worth it \u2014 usually under 5 seconds.", name: "Alicia Reyes", role: "QA Engineer", initials: "AR" },
  { quote: "The wallet ledger is what sold me. I can see exactly what every rental cost, down to the cent.", name: "Tomasz Nowak", role: "Indie Developer", initials: "TN" },
  { quote: "No approval step, no waiting around \u2014 I rent a number and it just works.", name: "Priya Nair", role: "Growth Marketer", initials: "PN" },
  { quote: "Cancelled a rental that didn't get a code and the refund landed in my wallet immediately.", name: "Derek Osei", role: "Freelancer", initials: "DO" },
  { quote: "Catalog is genuinely huge \u2014 haven't hit a service yet that wasn't listed.", name: "Hana Kobayashi", role: "Automation Tester", initials: "HK" },
  { quote: "Simple to set up, and the pricing is visible before you commit to anything.", name: "Marcus Webb", role: "Startup Founder", initials: "MW" },
];

const faqs = [
  { q: "How quickly will I get my code?", a: "We poll for incoming SMS every few seconds and surface the code the moment it lands \u2014 most rentals see a code within seconds of the message being sent." },
  { q: "What happens if I don't receive a code?", a: "Cancel the rental from your dashboard and the unused portion of your charge is automatically refunded to your wallet." },
  { q: "Can I receive more than one code on the same number?", a: "That depends on the service \u2014 some support multiple SMS on a single rental, which is shown up front before you rent." },
  { q: "How do I add funds?", a: "Deposits go straight into your wallet balance, which every rental draws from \u2014 no need to enter payment details each time." },
];

export default function Landing() {
  return (
    <div>
      <section className="landing-hero">
        <div>
          <span className="landing-kicker">$ kincaid dispatch --live</span>
          <h1 className="landing-title">Rent a number.<br />Get the code. Move on.</h1>
          <p className="landing-sub">
            KincaidSMS hands your app a real, working phone number in seconds and
            surfaces the verification code the moment it lands.
          </p>
          <div className="landing-cta-row">
            <Link to="/register" className="btn">Get started</Link>
            <a href="#how" className="btn secondary">See how it works</a>
          </div>
          <div className="landing-badges">
            {heroBadges.map((b) => (
              <div className="landing-badge" key={b}>
                <span className="landing-badge-dot" />{b}
              </div>
            ))}
          </div>
        </div>
        <TickerCard />
      </section>

      <div className="landing-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="stat-num">{s.num}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <section id="features" style={{ padding: "56px 0 0" }}>
        <span className="section-kicker">Why KincaidSMS</span>
        <h2 className="section-title">Built for speed and clarity</h2>
        <p className="section-sub">No manual steps between you and a working number.</p>
        <div className="landing-grid">
          {features.map((f) => (
            <div className="feature-card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" style={{ padding: "16px 0 0" }}>
        <span className="section-kicker">Process</span>
        <h2 className="section-title">Four steps, start to finish</h2>
        <p className="section-sub">From deposit to verified code, nothing waits on a human.</p>
        <div className="steps-grid">
          {steps.map((s) => (
            <div className="step-card" key={s.num}>
              <span className="step-num">{s.num}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="testimonials" style={{ padding: "16px 0 0" }}>
        <span className="section-kicker">What people say</span>
        <h2 className="section-title">Trusted for real workloads</h2>
        <p className="section-sub">Early feedback from people using KincaidSMS day to day.</p>
        <div className="testimonial-grid">
          {testimonials.map((t) => (
            <div className="testimonial-card" key={t.name}>
              <p className="testimonial-quote">&ldquo;{t.quote}&rdquo;</p>
              <div className="testimonial-person">
                <div className="testimonial-avatar">{t.initials}</div>
                <div>
                  <div className="testimonial-name">{t.name}</div>
                  <div className="testimonial-role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" style={{ padding: "16px 0 0" }}>
        <span className="section-kicker">Questions</span>
        <h2 className="section-title">Frequently asked questions</h2>
        <p className="section-sub">Everything you need to know before your first rental.</p>
        <div className="faq-list">
          {faqs.map((f) => (
            <div className="faq-item" key={f.q}>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="cta-banner">
        <h2>Ready to rent your first number?</h2>
        <p>Deposit, rent, and get your code in seconds.</p>
        <Link to="/register" className="btn">Create an account</Link>
      </div>

      <footer className="landing-footer">
        KincaidSMS &middot; built on the Getatext network
      </footer>
    </div>
  );
}
