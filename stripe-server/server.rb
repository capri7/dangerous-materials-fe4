require 'stripe'
require 'sinatra'
require 'json'

# This is your test secret API key.
Stripe.api_key =  ENV['STRIPE_SECRET_KEY'] ||'sk_test_51RaChNCAmzN6gSi3ixtXa1OWqHVVhUNwcPVvYbpje0KSm7JyanvC4N9WzJ7kSOtOLdOZjRoMsx8vMIRJypJdinuX00Ins52ucp'
YOUR_DOMAIN    = ENV['BASE_URL'] || 'http://localhost:4242'

ALLOWED_PLANS = {
  'z4_monthly_plan' => ENV['STRIPE_PRICE_Z4_MONTHLY'] # 例: price_123
}.freeze


# プロジェクト直下の public フォルダを静的ファイル配信先に
set :public_folder, File.expand_path('../public', __dir__)
set :static, true

set :port, 4242

get '/' do
  send_file File.join(settings.public_folder, 'index.html')
end


post '/create-checkout-session' do
    agreed = %w[on true 1].include?((params['agree'] || '').downcase)
  halt 400, 'AGREE_REQUIRED: 規約とプライバシーに同意してください' unless agreed

  lookup_key = params['lookup_key']
  price_id   = ALLOWED_PLANS[lookup_key]
  halt 400, 'INVALID_PLAN' unless price_id

  begin
    session = Stripe::Checkout::Session.create({
      mode: 'subscription',
      line_items: [{
        quantity: 1,
        price: price_id
      }],
      success_url: "#{YOUR_DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url:  "#{YOUR_DOMAIN}/cancel.html",
    })
  rescue StandardError => e
    halt 400,
         { 'Content-Type' => 'application/json' },
         { error: { message: e.message } }.to_json
  end

  redirect session.url, 303
end

post '/create-portal-session' do
  content_type 'application/json'
  # For demonstration purposes, we're using the Checkout session to retrieve the customer ID.
  # Typically this is stored alongside the authenticated user in your database.
  checkout_session_id = params['session_id']
  checkout_session = Stripe::Checkout::Session.retrieve(checkout_session_id)

  # This is the URL to which users will be redirected after they're done
  # managing their billing.
  return_url = YOUR_DOMAIN

  session = Stripe::BillingPortal::Session.create({
                                                    customer: checkout_session.customer,
                                                    return_url: return_url
                                                  })
  redirect session.url, 303
end

post '/webhook' do
  # Replace this endpoint secret with your endpoint's unique secret
  # If you are testing with the CLI, find the secret by running 'stripe listen'
  # If you are using an endpoint defined with the API or dashboard, look in your webhook settings
  # at https://dashboard.stripe.com/webhooks
  content_type 'application/json'

  webhook_secret = ENV['STRIPE_WEBHOOK_SECRET'].to_s
  payload = request.body.read

  if !webhook_secret.empty?
    sig_header = request.env['HTTP_STRIPE_SIGNATURE']
    begin
      event = Stripe::Webhook.construct_event(payload, sig_header, webhook_secret)
    rescue JSON::ParserError
      status 400 and return
    rescue Stripe::SignatureVerificationError
      puts '⚠️  Webhook signature verification failed.'
      status 400 and return
    end
  else
    data = JSON.parse(payload, symbolize_names: true)
    event = Stripe::Event.construct_from(data)
  end

  # イベント別のハンドリング（ログだけでもOK）
  case event.type
  when 'customer.subscription.deleted'
    puts "Subscription canceled: #{event.id}"
  when 'customer.subscription.updated'
    puts "Subscription updated: #{event.id}"
  when 'customer.subscription.created'
    puts "Subscription created: #{event.id}"
  when 'customer.subscription.trial_will_end'
    puts "Subscription trial will end: #{event.id}"
  when 'entitlements.active_entitlement_summary.updated'
    puts "Active entitlement summary updated: #{event.id}"
  end

  { status: 'success' }.to_json
end
