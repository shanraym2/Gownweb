'use client'

import Header from '../components/Header'
import Footer from '../components/Footer'

export default function ContactPage() {
  const handleSubmit = (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const name = form.name.value
    const email = form.email.value
    const message = form.message.value

    const subject = `Bridal inquiry from ${name || 'guest'}`
    const bodyLines = [
      `Name: ${name}`,
      `Email: ${email}`,
      '',
      'Message:',
      message,
    ]

    const body = encodeURIComponent(bodyLines.join('\n'))
    window.location.href = `mailto:hello@jcebridal.com?subject=${encodeURIComponent(subject)}&body=${body}`
  }

  return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />

      <section className="auth-section">
        <div className="container auth-layout">
          <div className="auth-copy">
            <span className="subtitle">Contact Us</span>
            <h1>We’d love to hear from you</h1>
            <p>
              Visit our studio or send us a message about fittings, custom gowns, or availability for your wedding date.
            </p>

            <div className="contact-details">
              <p><strong>Studio Address</strong><br />Quezon City, Metro Manila, Philippines</p>
              <p><strong>Phone</strong><br />+63 917 123 4567</p>
              <p><strong>Email</strong><br />karina@jcebridal.com</p>
              <p><strong>Studio Hours</strong><br />Monday – Saturday, 10:00 AM – 7:00 PM (PH Time)</p>
            </div>
          </div>

          <div className="auth-card">
            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" type="text" placeholder="Your full name" />
              </div>

              <div className="auth-field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" placeholder="you@example.com" />
              </div>

              <div className="auth-field">
                <label htmlFor="message">Message</label>
                <textarea id="message" name="message" rows={5} placeholder="Tell us about your event and preferred date." />
              </div>

              <button type="submit" className="btn btn-primary auth-submit">
                Send via Email
              </button>
            </form>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

