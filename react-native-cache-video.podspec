require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-cache-video"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/nguyenvanphituoc/react-native-cache-video.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm}"

  # RN >= 0.71 always provides this helper; the library is New-Architecture-only.
  install_modules_dependencies(s)
end
