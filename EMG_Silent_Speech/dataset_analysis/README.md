# Dataset Analysis (Beginner Friendly)

This folder has **one script** that checks your dataset in a very simple way.

File:
- `run_analysis.py`

## What this script does (step by step)
1. **Start**
2. **Import libraries**
3. **Set paths**
4. **Check dataset exists**
5. **Read folders**
6. **Count files (samples)**
7. **Check signal lengths**
8. **Check balance** (are classes roughly equal?)
9. **Detect outliers** (very long/short signals)
10. **Check normalization** (mean and std)
11. **Analyze channels** (how many columns)
12. **Extract features** (RMS, MAV, ZC)
13. **Generate plots** (one waveform per class)
14. **Check train/val/test split**
15. **End**

## How to run
```bash
python dataset_analysis/run_analysis.py
```

## What you will see in the terminal
- Total files per class
- Signal length stats
- Balance info
- Outliers count
- Mean and std for normalization
- Channel info
- Simple features (RMS, MAV, ZC)
- Train/Val/Test counts

## What files are created
Plots are saved here:
- `dataset_analysis/plots/`

Each class gets one waveform image like:
- `waveform_Do.png`
- `waveform_Need_Medical_Assistance.png`

## Why this is useful
It helps you **prove the dataset is real and usable** before training.
You can show these outputs in your internal as evidence.