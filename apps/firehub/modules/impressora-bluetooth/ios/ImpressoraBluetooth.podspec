Pod::Spec.new do |s|
  s.name           = 'ImpressoraBluetooth'
  s.version        = '1.0.0'
  s.summary        = 'Impressora térmica Bluetooth do app FireHub'
  s.description    = 'No iPhone ainda não imprime: a térmica comum é Bluetooth clássico (SPP), que o iOS não abre para apps.'
  s.author         = 'FireHub'
  s.homepage       = 'https://firehubfood.com.br'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
end
