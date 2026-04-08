import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  Search,
  Brain,
  CheckCircle2,
  Building2,
  Layers,
  Grid3X3,
  Warehouse,
  HardHat,
  Shield,
  FileSpreadsheet,
  Eye,
  Scan,
  Menu,
  X,
  ArrowRight,
  Star,
  Zap,
  Clock,
  ChevronRight,
} from "lucide-react";

/* ─── Navbar ─── */
const Navbar: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
          <HardHat className="h-6 w-6 text-primary" />
          Rebar&nbsp;<span className="text-primary">PRO</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-6 md:flex">
          <a href="#steps" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
          <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
          <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
          <Link to="/auth">
            <Button size="sm">Get Started</Button>
          </Link>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-foreground" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-background px-4 pb-4 pt-2 md:hidden flex flex-col gap-3">
          <a href="#steps" onClick={() => setOpen(false)} className="text-sm py-1.5">How It Works</a>
          <a href="#features" onClick={() => setOpen(false)} className="text-sm py-1.5">Features</a>
          <a href="#pricing" onClick={() => setOpen(false)} className="text-sm py-1.5">Pricing</a>
          <a href="#faq" onClick={() => setOpen(false)} className="text-sm py-1.5">FAQ</a>
          <Link to="/auth" onClick={() => setOpen(false)}><Button className="w-full" size="sm">Get Started</Button></Link>
        </div>
      )}
    </nav>
  );
};

/* ─── Hero ─── */
const HeroSection: React.FC = () => (
  <section className="relative overflow-hidden bg-foreground pt-28 pb-20 sm:pt-36 sm:pb-28">
    {/* Decorative grid */}
    <div className="absolute inset-0 opacity-[0.04]" style={{
      backgroundImage: "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
      backgroundSize: "60px 60px",
    }} />
    <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
      <Badge variant="outline" className="mb-5 border-primary/30 text-primary bg-primary/10">
        <Zap className="mr-1 h-3 w-3" /> AI-Powered Rebar Estimation
      </Badge>
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-primary-foreground sm:text-5xl lg:text-6xl">
        Rebar Takeoff in Minutes,<br className="hidden sm:block" /> Not Days
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-base text-primary-foreground/60 sm:text-lg">
        Upload structural blueprints. Our 5-layer AI reads every bar mark, spacing call-out, and detail reference — then produces a trust-verified estimate you can price with confidence.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link to="/auth">
          <Button size="lg" className="gap-2 text-base font-semibold px-8">
            Start Free Trial <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <a href="#steps">
          <Button variant="outline" size="lg" className="gap-2 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
            See How It Works
          </Button>
        </a>
      </div>
    </div>
  </section>
);

/* ─── Social Proof ─── */
const SocialProofBar: React.FC = () => {
  const stats = [
    { value: "90%", label: "Faster Takeoffs" },
    { value: "5-Layer", label: "OCR Engine" },
    { value: "< 2%", label: "Variance Rate" },
    { value: "24/7", label: "AI Processing" },
  ];
  return (
    <section className="border-b border-border bg-muted/50 py-10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-8 px-4 sm:gap-16">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-2xl font-bold text-primary sm:text-3xl">{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground sm:text-sm">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ─── 4-Step Process ─── */
const steps = [
  { icon: Upload, title: "Upload Blueprints", desc: "Drag & drop structural and architectural PDFs. We handle multi-page sets automatically." },
  { icon: Search, title: "Detect Scope", desc: "AI follows the concrete — identifying foundations, slabs, walls, columns, and beams across all disciplines." },
  { icon: Brain, title: "AI Takeoff", desc: "5-layer OCR extracts bar marks, sizes, spacings, lengths, bends, and coating from every sheet." },
  { icon: CheckCircle2, title: "Review & Approve", desc: "Trust-first workspace separates approved vs pending totals. Nothing leaves until you say it's ready." },
];

const StepsSection: React.FC = () => (
  <section id="steps" className="scroll-mt-20 py-16 sm:py-24">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="text-center">
        <Badge variant="secondary" className="mb-3">How It Works</Badge>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">From PDF to Priced Estimate in 4 Steps</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">No manual counting. No missed bars. Upload, review, approve.</p>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.title} className="group relative rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <s.icon className="h-5 w-5" />
            </div>
            <span className="absolute right-4 top-4 text-xs font-bold text-muted-foreground/40">0{i + 1}</span>
            <h3 className="text-sm font-semibold">{s.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Features ─── */
const features = [
  { icon: Shield, title: "Trust-First Totals", desc: "Approved and pending totals shown separately. Pricing is locked until all blocked items are resolved — no misleading numbers." },
  { icon: FileSpreadsheet, title: "Shop Drawing Generation", desc: "Auto-generate per-segment shop drawings with bending schedules, bar lists, and placement plans — matching industry standards." },
  { icon: Eye, title: "Evidence Grading", desc: "Every line item links to source sheets, OCR text, and confidence scores so reviewers see exactly where each number came from." },
  { icon: Scan, title: "Multi-Discipline Detection", desc: "AI scans structural and architectural drawings together, resolving conflicts between embedded rebar details and structural schedules." },
];

const FeaturesSection: React.FC = () => (
  <section id="features" className="scroll-mt-20 border-t border-border bg-muted/30 py-16 sm:py-24">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="text-center">
        <Badge variant="secondary" className="mb-3">Features</Badge>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for Rebar Estimators</h2>
      </div>
      <div className="mt-14 grid gap-6 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="flex gap-4 rounded-xl border border-border bg-card p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <f.icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── 5 Construction Buckets ─── */
const buckets = [
  { icon: Building2, name: "Substructure", items: "Footings, pile caps, grade beams, foundation walls" },
  { icon: Layers, name: "Slab-on-Grade", items: "Mesh, chairs, dowels, construction joints" },
  { icon: Grid3X3, name: "Superstructure", items: "Columns, beams, elevated slabs, shear walls" },
  { icon: Warehouse, name: "Masonry", items: "Bond beams, lintels, jamb reinforcing, vertical cells" },
  { icon: HardHat, name: "Site / Civil", items: "Retaining walls, culverts, catch basins" },
];

const BucketsGrid: React.FC = () => (
  <section className="py-16 sm:py-24">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="text-center">
        <Badge variant="secondary" className="mb-3">Scope Coverage</Badge>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">5 Construction Buckets</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">AI categorizes every rebar element into its structural discipline automatically.</p>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.name} className="rounded-xl border border-border bg-card p-5 text-center transition-shadow hover:shadow-md">
            <b.icon className="mx-auto h-8 w-8 text-primary" />
            <h3 className="mt-3 text-sm font-semibold">{b.name}</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{b.items}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Pricing ─── */
const plans = [
  { name: "Starter", price: "$99", period: "/mo", features: ["5 projects / month", "AI takeoff engine", "Basic shop drawings", "Email support"], cta: "Start Free Trial", highlighted: false },
  { name: "Professional", price: "$249", period: "/mo", features: ["Unlimited projects", "5-layer OCR", "Shop drawings + bending schedules", "Multi-discipline detection", "Priority support"], cta: "Start Free Trial", highlighted: true },
  { name: "Enterprise", price: "Custom", period: "", features: ["Everything in Pro", "CRM integration", "Custom templates", "Dedicated account manager", "SSO & audit log"], cta: "Contact Sales", highlighted: false },
];

const PricingSection: React.FC = () => (
  <section id="pricing" className="scroll-mt-20 border-t border-border bg-muted/30 py-16 sm:py-24">
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      <div className="text-center">
        <Badge variant="secondary" className="mb-3">Pricing</Badge>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Simple, Transparent Pricing</h2>
      </div>
      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.name}
            className={`relative rounded-xl border p-6 ${
              p.highlighted
                ? "border-primary bg-card shadow-lg ring-1 ring-primary/20"
                : "border-border bg-card"
            }`}
          >
            {p.highlighted && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most Popular</Badge>
            )}
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold">{p.price}</span>
              {p.period && <span className="text-sm text-muted-foreground">{p.period}</span>}
            </div>
            <ul className="mt-5 space-y-2.5">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <Link to="/auth" className="mt-6 block">
              <Button variant={p.highlighted ? "default" : "outline"} className="w-full" size="sm">
                {p.cta}
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ─── FAQ ─── */
const faqs = [
  { q: "What drawing formats are supported?", a: "We accept PDF files — both vector-based CAD exports and scanned drawings. Our triple-pass OCR handles even low-resolution scans." },
  { q: "How does the 5-layer OCR work?", a: "Layer 1 extracts raw text (bar marks, spacings). Layer 2 classifies linework (concrete outlines, dimension strings). Layer 3 associates text with geometry. Layer 4 maps elements to structural segments. Layer 5 validates against engineering rules." },
  { q: "What does 'Trust-First' mean?", a: "We never show a single combined total. Approved items show a Trusted Total; items still under review show a separate Pending Total. Pricing and shop drawing generation are locked until all blocked items are resolved." },
  { q: "Can I handle both structural and architectural drawings?", a: "Yes. Our multi-discipline detection scans both sets, identifies which scope items appear on which discipline, and flags conflicts between embedded details and structural schedules." },
  { q: "How accurate is the AI takeoff?", a: "Typical variance is under 2% compared to manual takeoff. Every line item includes an evidence grade and source sheet reference so you can verify anything the AI found." },
];

const FAQSection: React.FC = () => (
  <section id="faq" className="scroll-mt-20 py-16 sm:py-24">
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      <div className="text-center">
        <Badge variant="secondary" className="mb-3">FAQ</Badge>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Frequently Asked Questions</h2>
      </div>
      <Accordion type="single" collapsible className="mt-10">
        {faqs.map((f, i) => (
          <AccordionItem key={i} value={`faq-${i}`}>
            <AccordionTrigger className="text-sm text-left">{f.q}</AccordionTrigger>
            <AccordionContent className="text-xs leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  </section>
);

/* ─── CTA Footer ─── */
const CTAFooter: React.FC = () => (
  <section className="border-t border-border bg-foreground py-16 sm:py-20">
    <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
      <h2 className="text-2xl font-bold text-primary-foreground sm:text-3xl">
        Ready to Estimate Faster?
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/60">
        Join estimators who save hours on every project. Start your free trial — no credit card required.
      </p>
      <Link to="/auth" className="mt-8 inline-block">
        <Button size="lg" className="gap-2 px-8 text-base font-semibold">
          Get Started Free <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
      <p className="mt-10 text-xs text-primary-foreground/30">
        © {new Date().getFullYear()} Rebar Estimator PRO. All rights reserved.
      </p>
    </div>
  </section>
);

/* ─── Page ─── */
const LandingPage: React.FC = () => (
  <div className="min-h-screen bg-background text-foreground">
    <Navbar />
    <HeroSection />
    <SocialProofBar />
    <StepsSection />
    <FeaturesSection />
    <BucketsGrid />
    <PricingSection />
    <FAQSection />
    <CTAFooter />
  </div>
);

export default LandingPage;
