#include <libopenmpt/libopenmpt.h>
#include <libopenmpt/libopenmpt_ext.hpp>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace fs = std::filesystem;

namespace {

struct Options {
  fs::path outputDir = "renders";
  std::int32_t sampleRate = 48000;
  std::int32_t stereoSeparation = 100;
  std::int32_t interpolationFilter = 8;
  double endTimeSeconds = 0.0;
  std::vector<fs::path> inputs;
};

std::string jsonEscape(std::string_view value) {
  std::string escaped;
  escaped.reserve(value.size() + 16);
  for (char ch : value) {
    switch (ch) {
      case '\\': escaped += "\\\\"; break;
      case '"': escaped += "\\\""; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          std::ostringstream out;
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(static_cast<unsigned char>(ch));
          escaped += out.str();
        } else {
          escaped += ch;
        }
        break;
    }
  }
  return escaped;
}

std::string sanitizeName(std::string_view value) {
  std::string clean;
  clean.reserve(value.size());
  for (char ch : value) {
    const bool safe =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch == '-' || ch == '_' || ch == '.';
    clean += safe ? ch : '_';
  }
  while (!clean.empty() && clean.back() == '.') clean.pop_back();
  if (clean.empty()) return "untitled";
  return clean;
}

fs::path uniqueSongDir(const fs::path &baseDir, const fs::path &inputPath) {
  const std::string stem = sanitizeName(inputPath.stem().string());
  const std::string ext = sanitizeName(inputPath.extension().string());
  fs::path candidate = baseDir / (ext.empty() ? stem : stem + "_" + ext.substr(1));
  if (!fs::exists(candidate)) return candidate;
  for (int suffix = 2; suffix < 10000; ++suffix) {
    fs::path withSuffix = candidate;
    withSuffix += "_" + std::to_string(suffix);
    if (!fs::exists(withSuffix)) return withSuffix;
  }
  throw std::runtime_error("Failed to allocate unique output directory for " + inputPath.string());
}

class WavWriter {
public:
  WavWriter(const fs::path &path, std::int32_t sampleRate, std::int16_t channels)
    : file_(path, std::ios::binary), sampleRate_(sampleRate), channels_(channels) {
    if (!file_) {
      throw std::runtime_error("Failed to open output file: " + path.string());
    }
    writeHeaderPlaceholder();
  }

  void writeFrames(const float *interleaved, std::size_t frameCount) {
    if (frameCount == 0) return;
    const std::size_t sampleCount = frameCount * static_cast<std::size_t>(channels_);
    file_.write(reinterpret_cast<const char *>(interleaved), static_cast<std::streamsize>(sampleCount * sizeof(float)));
    if (!file_) {
      throw std::runtime_error("Failed while writing WAV data");
    }
    bytesWritten_ += static_cast<std::uint32_t>(sampleCount * sizeof(float));
  }

  void finalize() {
    if (finalized_) return;
    finalized_ = true;

    file_.seekp(0, std::ios::beg);
    writeHeader();
    file_.flush();
  }

  ~WavWriter() {
    try {
      finalize();
    } catch (...) {
    }
  }

private:
  void writeLE16(std::uint16_t value) {
    char bytes[2] = {
      static_cast<char>(value & 0xff),
      static_cast<char>((value >> 8) & 0xff),
    };
    file_.write(bytes, 2);
  }

  void writeLE32(std::uint32_t value) {
    char bytes[4] = {
      static_cast<char>(value & 0xff),
      static_cast<char>((value >> 8) & 0xff),
      static_cast<char>((value >> 16) & 0xff),
      static_cast<char>((value >> 24) & 0xff),
    };
    file_.write(bytes, 4);
  }

  void writeHeaderPlaceholder() {
    writeHeader();
  }

  void writeHeader() {
    const std::uint32_t byteRate = static_cast<std::uint32_t>(sampleRate_) * static_cast<std::uint32_t>(channels_) * sizeof(float);
    const std::uint16_t blockAlign = static_cast<std::uint16_t>(channels_ * sizeof(float));
    const std::uint32_t riffSize = 36u + bytesWritten_;

    file_.write("RIFF", 4);
    writeLE32(riffSize);
    file_.write("WAVE", 4);

    file_.write("fmt ", 4);
    writeLE32(16);
    writeLE16(3);  // IEEE float
    writeLE16(static_cast<std::uint16_t>(channels_));
    writeLE32(static_cast<std::uint32_t>(sampleRate_));
    writeLE32(byteRate);
    writeLE16(blockAlign);
    writeLE16(32);

    file_.write("data", 4);
    writeLE32(bytesWritten_);
  }

  std::ofstream file_;
  std::int32_t sampleRate_;
  std::int16_t channels_;
  std::uint32_t bytesWritten_ = 0;
  bool finalized_ = false;
};

Options parseArgs(int argc, char *argv[]) {
  Options options;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto requireValue = [&](const char *name) -> std::string {
      if (i + 1 >= argc) throw std::runtime_error(std::string("Missing value for ") + name);
      return argv[++i];
    };
    if (arg == "--output-dir") {
      options.outputDir = requireValue("--output-dir");
    } else if (arg == "--samplerate") {
      options.sampleRate = std::stoi(requireValue("--samplerate"));
    } else if (arg == "--stereo") {
      options.stereoSeparation = std::stoi(requireValue("--stereo"));
    } else if (arg == "--filter") {
      options.interpolationFilter = std::stoi(requireValue("--filter"));
    } else if (arg == "--end-time") {
      options.endTimeSeconds = std::stod(requireValue("--end-time"));
    } else if (arg == "-h" || arg == "--help") {
      std::cout
        << "Usage: export_openmpt_stems [options] <module> [<module> ...]\n\n"
        << "Options:\n"
        << "  --output-dir DIR   Base output directory (default: renders)\n"
        << "  --samplerate N     Output sample rate in Hz (default: 48000)\n"
        << "  --stereo N         Stereo separation in percent (default: 100)\n"
        << "  --filter N         Interpolation filter taps: 1,2,4,8 (default: 8)\n"
        << "  --end-time SEC     Stop rendering at SEC seconds\n";
      std::exit(0);
    } else if (!arg.empty() && arg[0] == '-') {
      throw std::runtime_error("Unknown option: " + arg);
    } else {
      options.inputs.emplace_back(arg);
    }
  }

  if (options.inputs.empty()) {
    throw std::runtime_error("No input modules provided. Use --help for usage.");
  }
  if (options.sampleRate < 8000 || options.sampleRate > 192000) {
    throw std::runtime_error("Sample rate out of supported range");
  }
  if (!(options.interpolationFilter == 1 || options.interpolationFilter == 2 ||
        options.interpolationFilter == 4 || options.interpolationFilter == 8)) {
    throw std::runtime_error("Interpolation filter must be one of: 1, 2, 4, 8");
  }
  return options;
}

std::unique_ptr<openmpt::module_ext> openModule(const fs::path &path, const Options &options) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw std::runtime_error("Failed to open input file: " + path.string());
  }
  auto module = std::make_unique<openmpt::module_ext>(input);
  module->set_repeat_count(0);
  module->set_render_param(OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT, options.stereoSeparation);
  module->set_render_param(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, options.interpolationFilter);
  return module;
}

void renderModule(openmpt::module_ext &module, const fs::path &wavPath, const Options &options) {
  constexpr std::size_t kChunkFrames = 1024;
  std::vector<float> buffer(kChunkFrames * 2);
  WavWriter writer(wavPath, options.sampleRate, 2);

  const std::uint64_t frameLimit = options.endTimeSeconds > 0.0
    ? static_cast<std::uint64_t>(options.endTimeSeconds * options.sampleRate)
    : std::numeric_limits<std::uint64_t>::max();
  std::uint64_t framesWritten = 0;

  while (framesWritten < frameLimit) {
    const std::size_t remaining = static_cast<std::size_t>(std::min<std::uint64_t>(kChunkFrames, frameLimit - framesWritten));
    const std::size_t frames = module.read_interleaved_stereo(options.sampleRate, remaining, buffer.data());
    if (frames == 0) break;
    writer.writeFrames(buffer.data(), frames);
    framesWritten += frames;
  }

  writer.finalize();
}

std::string metadataValue(const openmpt::module_ext &module, const std::string &key) {
  try {
    return module.get_metadata(key);
  } catch (...) {
    return "";
  }
}

void writeMetadata(const fs::path &path, const fs::path &inputPath, const openmpt::module_ext &module, const Options &options) {
  std::ofstream out(path);
  if (!out) {
    throw std::runtime_error("Failed to write metadata file: " + path.string());
  }

  out << "{\n";
  out << "  \"input_path\": \"" << jsonEscape(fs::absolute(inputPath).string()) << "\",\n";
  out << "  \"title\": \"" << jsonEscape(metadataValue(module, "title")) << "\",\n";
  out << "  \"artist\": \"" << jsonEscape(metadataValue(module, "artist")) << "\",\n";
  out << "  \"tracker\": \"" << jsonEscape(metadataValue(module, "tracker")) << "\",\n";
  out << "  \"type\": \"" << jsonEscape(metadataValue(module, "type")) << "\",\n";
  out << "  \"type_long\": \"" << jsonEscape(metadataValue(module, "type_long")) << "\",\n";
  out << "  \"duration_seconds\": " << module.get_duration_seconds() << ",\n";
  out << "  \"channel_count\": " << module.get_num_channels() << ",\n";
  out << "  \"sample_rate\": " << options.sampleRate << ",\n";
  out << "  \"render_format\": \"wav-f32\",\n";
  out << "  \"stereo_separation\": " << options.stereoSeparation << ",\n";
  out << "  \"interpolation_filter\": " << options.interpolationFilter << ",\n";
  out << "  \"repeat_count\": 0,\n";
  out << "  \"export_mode\": \"per-channel\"\n";
  out << "}\n";
}

void exportSong(const fs::path &inputPath, const Options &options) {
  std::cout << "[openmpt] exporting " << inputPath << "\n";
  auto probeModule = openModule(inputPath, options);
  const auto songDir = uniqueSongDir(options.outputDir, inputPath);
  const auto stemsDir = songDir / "stems";
  const auto metaDir = songDir / "meta";
  fs::create_directories(stemsDir);
  fs::create_directories(metaDir);

  renderModule(*probeModule, songDir / "master.wav", options);
  writeMetadata(metaDir / "song.json", inputPath, *probeModule, options);

#ifdef LIBOPENMPT_EXT_INTERFACE_INTERACTIVE
  const std::int32_t channelCount = probeModule->get_num_channels();
  for (std::int32_t channel = 0; channel < channelCount; ++channel) {
    auto stemModule = openModule(inputPath, options);
    auto *interactive = static_cast<openmpt::ext::interactive *>(stemModule->get_interface(openmpt::ext::interactive_id));
    if (!interactive) {
      throw std::runtime_error("libopenmpt interactive extension is unavailable; cannot export channel stems");
    }
    for (std::int32_t other = 0; other < channelCount; ++other) {
      interactive->set_channel_mute_status(other, other != channel);
    }

    std::ostringstream stemName;
    stemName << "channel_" << std::setw(2) << std::setfill('0') << (channel + 1) << ".wav";
    renderModule(*stemModule, stemsDir / stemName.str(), options);
  }
#else
  throw std::runtime_error("libopenmpt was built without LIBOPENMPT_EXT_INTERFACE_INTERACTIVE support");
#endif
}

}  // namespace

int main(int argc, char *argv[]) {
  try {
    const Options options = parseArgs(argc, argv);
    fs::create_directories(options.outputDir);
    for (const auto &input : options.inputs) {
      exportSong(input, options);
    }
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "Error: " << e.what() << "\n";
    return 1;
  }
}