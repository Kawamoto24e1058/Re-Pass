import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../widgets/glass_box.dart';

import 'pricing_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final TextEditingController _titleController = TextEditingController();
  String _selectedMode = 'note';
  double _targetLength = 2000;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.white.withOpacity(0.0),
        flexibleSpace: ClipRect(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
            child: Container(color: Colors.white.withOpacity(0.3)),
          ),
        ),
        title: Text(
          'Re-Pass',
          style: GoogleFonts.outfit(
            fontWeight: FontWeight.bold,
            color: const Color(0xFF1E293B),
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Pro機能をアンロック',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const PricingScreen()),
              );
            },
            icon: const CircleAvatar(
              radius: 16,
              backgroundColor: Color(0xFF1E293B), // Dark background for emphasis
              child: Icon(Icons.star, size: 18, color: Color(0xFFFFD700)), // Gold star
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const CircleAvatar(
              radius: 16,
              backgroundColor: Color(0xFFF1F5F9),
              child: Icon(Icons.person, size: 20, color: Color(0xFF4F46E5)),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFFF9FAFB),
              Color(0xFFEEF2FF),
            ],
          ),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 120, 20, 100),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Welcome Text
              Text(
                'こんにちは！',
                style: GoogleFonts.outfit(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: const Color(0xFF1E293B),
                ),
              ),
              const Text(
                '新しい講義の記録を始めましょう',
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 32),

              // Main Analysis Card
              GlassBox(
                color: Colors.white,
                opacity: 0.6,
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Title Input
                      TextField(
                        controller: _titleController,
                        style: GoogleFonts.outfit(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF1E293B),
                        ),
                        decoration: InputDecoration(
                          hintText: '講義タイトル',
                          hintStyle: TextStyle(color: const Color(0xFF1E293B).withOpacity(0.2)),
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                      const SizedBox(height: 8),
                      // Gradient line
                      Container(
                        width: 60,
                        height: 6,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF4F46E5), Color(0xFFEC4899)],
                          ),
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                      const SizedBox(height: 32),

                      // Mode Selection
                      const Text(
                        '生成モード',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF94A3B8),
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEEF2FF).withOpacity(0.5),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          children: [
                            _buildModeButton('note', 'ノート'),
                            _buildModeButton('thoughts', '感想'),
                            _buildModeButton('report', 'レポート'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 32),

                      // Target Length
                      Row(
                        mainAxisAlignment: MainAxisAlignment.between,
                        children: [
                          const Text(
                            '目標文字数',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF94A3B8),
                              letterSpacing: 1.2,
                            ),
                          ),
                          Text(
                            '${_targetLength.toInt()} 文字',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF4F46E5),
                            ),
                          ),
                        ],
                      ),
                      Slider(
                        value: _targetLength,
                        min: 100,
                        max: 4000,
                        divisions: 39,
                        activeColor: const Color(0xFF4F46E5),
                        inactiveColor: const Color(0xFFE2E8F0),
                        onChanged: (val) => setState(() => _targetLength = val),
                      ),
                      
                      const SizedBox(height: 24),
                      // Analyze Button
                      ElevatedButton(
                        onPressed: () {},
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF1E293B),
                          foregroundColor: Colors.white,
                          minimumSize: const Size(double.infinity, 56),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('解析を開始', style: TextStyle(fontWeight: FontWeight.bold)),
                            SizedBox(width: 8),
                            Icon(Icons.arrow_forward, size: 18),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.large(
        onPressed: () {},
        backgroundColor: const Color(0xFF1E293B),
        foregroundColor: Colors.white,
        shape: const CircleBorder(),
        child: const Icon(Icons.mic, size: 36, color: Color(0xFFEF4444)),
      ),
    );
  }

  Widget _buildModeButton(String mode, String label) {
    bool isSelected = _selectedMode == mode;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedMode = mode),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.05),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: isSelected ? const Color(0xFF1E293B) : const Color(0xFF94A3B8),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
import 'dart:ui';
