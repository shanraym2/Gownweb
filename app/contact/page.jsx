'use client'

import { useState, useCallback } from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'

const CONTACT_DETAILS = [
  {
    label: 'Studio Address',
    value: 'Quezon City, Metro Manila\nPhilippines',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s-8-5.25-8-12a8 8 0 0 1 16 0c0 6.75-8 12-8 12z"/>
        <circle cx="12" cy="10" r="2.5"/>
      </svg>
    ),
  },
  {
    label: 'Phone',
    value: '+63 917 123 4567',
    href: 'tel:+639171234567',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
  },
  {
    label: 'Email',
    value: 'karina@jcebridal.com',
    href: 'mailto:ayacochokarina@gmail.com',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="m2 7 10 7 10-7"/>
      </svg>
    ),
  },
  {
    label: 'Studio Hours',
    value: 'Mon – Sat  ·  10:00 AM – 7:00 PM\nPhilippine Standard Time',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
]

const INITIAL_FIELDS = { name: '', email: '', message: '' }
const INITIAL_ERRORS = { name: '', email: '', message: '' }

function validate({ name, email, message }) {
  const errors = { ...INITIAL_ERRORS }
  if (!name.trim())               errors.name    = 'Please enter your name.'
  if (!email.trim())              errors.email   = 'Please enter your email.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                                  errors.email   = 'Please enter a valid email address.'
  if (!message.trim())            errors.message = 'Please write a short message.'
  else if (message.trim().length < 10)
                                  errors.message = 'Message is too short — add a few more details.'
  return errors
}

function hasErrors(errors) {
  return Object.values(errors).some(Boolean)
}

export default function ContactPage() {
  const [fields, setFields]   = useState(INITIAL_FIELDS)
  const [errors, setErrors]   = useState(INITIAL_ERRORS)
  const [touched, setTouched] = useState({})
  const [status, setStatus]   = useState('idle') // idle | sending | sent

  const handleChange = useCallback((e) => {
    const { name, value } = e.target
    setFields(prev => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
  }, [errors])

  const handleBlur = useCallback((e) => {
    const { name } = e.target
    setTouched(prev => ({ ...prev, [name]: true }))
    const fieldErrors = validate({ ...fields, [name]: fields[name] })
    setErrors(prev => ({ ...prev, [name]: fieldErrors[name] }))
  }, [fields])

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    const validationErrors = validate(fields)
    setErrors(validationErrors)
    setTouched({ name: true, email: true, message: true })

    if (hasErrors(validationErrors)) return

    setStatus('sending')

    const subject  = `Bridal inquiry from ${fields.name}`
    const bodyText = [
      `Name: ${fields.name}`,
      `Email: ${fields.email}`,
      '',
      'Message:',
      fields.message,
    ].join('\n')

    window.location.href =
      `mailto:karina@jcebridal.com` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(bodyText)}`

    setTimeout(() => {
      setStatus('sent')
      setFields(INITIAL_FIELDS)
      setTouched({})
    }, 600)
  }, [fields])

  const handleReset = useCallback(() => {
    setStatus('idle')
    setErrors(INITIAL_ERRORS)
  }, [])

  return (
    <main className="contact-page">
      <Header solid/>
      <div className="contact-header-spacer" />

      <section className="contact-section">

        <div className="contact-left">
          <div className="contact-left-inner">
            <span className="contact-eyebrow">Get in Touch</span>
            <h1 className="contact-heading">
              We'd love to<br />
              <em>hear from you.</em>
            </h1>
            <p className="contact-intro">
              Visit our studio or send us a message about fittings, custom gowns,
              or availability for your wedding date.
            </p>

            <ul className="contact-details" role="list">
              {CONTACT_DETAILS.map(({ label, value, href, icon }) => (
                <li key={label} className="contact-detail-item">
                  <span className="contact-detail-icon" aria-hidden="true">{icon}</span>
                  <div>
                    <span className="contact-detail-label">{label}</span>
                    {href ? (
                      <a href={href} className="contact-detail-value contact-detail-link">
                        {value}
                      </a>
                    ) : (
                      <span className="contact-detail-value">{value}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="contact-right">
          <div className="contact-card">

            {status === 'sent' ? (
              <div className="contact-success" role="status" aria-live="polite">
                <div className="contact-success-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <h2 className="contact-success-title">Message sent!</h2>
                <p className="contact-success-body">
                  Your email client should have opened with your message pre-filled.
                  We'll be in touch within one business day.
                </p>
                <button
                  type="button"
                  className="btn-contact-ghost"
                  onClick={handleReset}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <p className="contact-form-lead">Send us a message</p>

                <div className="contact-row">
                  <div className={`contact-field ${touched.name && errors.name ? 'has-error' : ''}`}>
                    <label htmlFor="name">Full Name</label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      placeholder="Your full name"
                      value={fields.name}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      autoComplete="name"
                      aria-describedby={errors.name ? 'name-error' : undefined}
                      aria-invalid={touched.name && !!errors.name}
                    />
                    {touched.name && errors.name && (
                      <span id="name-error" className="field-error" role="alert">{errors.name}</span>
                    )}
                  </div>

                  <div className={`contact-field ${touched.email && errors.email ? 'has-error' : ''}`}>
                    <label htmlFor="email">Email Address</label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      value={fields.email}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      autoComplete="email"
                      aria-describedby={errors.email ? 'email-error' : undefined}
                      aria-invalid={touched.email && !!errors.email}
                    />
                    {touched.email && errors.email && (
                      <span id="email-error" className="field-error" role="alert">{errors.email}</span>
                    )}
                  </div>
                </div>

                <div className={`contact-field ${touched.message && errors.message ? 'has-error' : ''}`}>
                  <label htmlFor="message">Message</label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    placeholder="Tell us about your opinions..."
                    value={fields.message}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    aria-describedby={errors.message ? 'message-error' : undefined}
                    aria-invalid={touched.message && !!errors.message}
                  />
                  {touched.message && errors.message && (
                    <span id="message-error" className="field-error" role="alert">{errors.message}</span>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-contact-submit"
                  disabled={status === 'sending'}
                  aria-busy={status === 'sending'}
                >
                  {status === 'sending' ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" />
                      Opening mail client…
                    </>
                  ) : (
                    <>
                      Send Message
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="22" y1="2" x2="11" y2="13"/>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                      </svg>
                    </>
                  )}
                </button>
              </form>
            )}

          </div>
        </div>

      </section>

      <Footer />
    </main>
  )
}